import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  // NestJS constructor DI needs emitted decorator metadata, which esbuild
  // (Vitest's default transformer) does not produce. unplugin-swc emits it.
  plugins: [
    swc.vite({
      jsc: {
        target: "esnext",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: { environment: "node", globals: true, testTimeout: 30000 },
});
