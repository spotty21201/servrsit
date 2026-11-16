import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
});

const healthPlugin: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/health",
    {
      schema: {
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async (_request, _reply) => {
      return {
        status: "ok" as const,
        timestamp: new Date().toISOString(),
      };
    }
  );
};

export default healthPlugin;
