// Node module hooks: `import styles from "./x.module.css"` returns names like "x__primary",
// plain `import "./x.css"` returns an empty module. The real CSS is read separately (css.mts).
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    const file = basename(fileURLToPath(url)).replace(/\.module\.css$|\.css$/, "");
    const source = url.endsWith(".module.css")
      ? `export default new Proxy({}, { get: (_, k) => (typeof k === "string" ? ${JSON.stringify(file + "__")} + k : undefined) });`
      : "export default {};";
    return { format: "module", shortCircuit: true, source };
  }
  return nextLoad(url, context);
}
