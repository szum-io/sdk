import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  target: "node24",
  dts: {
    compilerOptions: {
      ignoreDeprecations: "6.0",
    },
  },
  clean: true,
  outDir: "dist",
});
