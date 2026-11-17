import { test } from "node:test";
import assert from "node:assert/strict";
import { createAsyncLogStream } from "./log-stream.js";

type Cb = (err: NodeJS.ErrnoException | null, written: number) => void;

/** A fake fd: each write waits until the test answers it. */
function fakeFd() {
  const calls: Array<{ data: string; cb: Cb }> = [];
  const timers: Array<{ fn: () => void; unrefd: boolean }> = [];
  const writeFn = (_fd: number, buf: Buffer, _o: number, len: number, _p: null, cb: Cb) => {
    calls.push({ data: buf.subarray(0, len).toString("utf8"), cb });
  };
  const setTimer = (fn: () => void) => {
    const t = { fn, unrefd: false };
    timers.push(t);
    return { unref: () => { t.unrefd = true; } };
  };
  const err = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });
  return { calls, timers, writeFn, setTimer, err };
}

test("one write in flight at a time, in order", () => {
  const f = fakeFd();
  const s = createAsyncLogStream({ writeFn: f.writeFn, setTimer: f.setTimer });
  s.write("a\n"); s.write("b\n"); s.write("c\n");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.data, "a\n");
  f.calls[0]!.cb(null, 2);
  assert.equal(f.calls[1]!.data, "b\n");
  f.calls[1]!.cb(null, 2);
  f.calls[2]!.cb(null, 2);
  assert.deepEqual(f.calls.map((c) => c.data), ["a\n", "b\n", "c\n"]);
  assert.equal(s.pendingBytes, 0);
});

test("a partial write sends the remainder next", () => {
  const f = fakeFd();
  const s = createAsyncLogStream({ writeFn: f.writeFn, setTimer: f.setTimer });
  s.write("hello\n");
  f.calls[0]!.cb(null, 2);
  assert.equal(f.calls[1]!.data, "llo\n");
  f.calls[1]!.cb(null, 4);
  assert.equal(s.pendingBytes, 0);
});

test("EAGAIN (pipe full) retries later on an unref'd timer, without blocking", () => {
  const f = fakeFd();
  const s = createAsyncLogStream({ writeFn: f.writeFn, setTimer: f.setTimer });
  s.write("x\n");
  f.calls[0]!.cb(f.err("EAGAIN"), 0);
  assert.equal(f.calls.length, 1, "no immediate retry loop");
  assert.equal(f.timers.length, 1);
  assert.equal(f.timers[0]!.unrefd, true, "the retry timer must not keep the process alive");
  s.write("y\n");
  assert.equal(f.calls.length, 1, "nothing new is sent while waiting");
  f.timers[0]!.fn();
  assert.equal(f.calls[1]!.data, "x\n", "the same line is retried first");
});

test("output is capped while the reader is stalled; overflow is dropped and counted", () => {
  const f = fakeFd();
  const s = createAsyncLogStream({ writeFn: f.writeFn, setTimer: f.setTimer, maxPendingBytes: 10 });
  s.write("12345\n");
  s.write("abc\n");
  s.write("this does not fit\n");
  assert.equal(s.pendingBytes, 10);
  assert.equal(s.dropped, 1);
});

test("EPIPE (reader gone) stops output and drops what is queued; writes never throw", () => {
  const f = fakeFd();
  const s = createAsyncLogStream({ writeFn: f.writeFn, setTimer: f.setTimer });
  s.write("a\n"); s.write("b\n");
  f.calls[0]!.cb(f.err("EPIPE"), 0);
  assert.equal(s.stopped, true);
  assert.equal(s.pendingBytes, 0);
  assert.doesNotThrow(() => s.write("c\n"));
  assert.equal(f.calls.length, 1, "nothing more is written");
  assert.equal(s.dropped, 3, "the two queued lines plus the line written after output stopped");
});

test("it has no synchronous flush that an exit handler could block on", () => {
  const s = createAsyncLogStream({ writeFn: fakeFd().writeFn });
  assert.equal("flushSync" in s, false);
  assert.equal("fsync" in s, false);
});
