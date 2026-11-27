/// <reference types="vite/client" />
import type { GenericSchema, SchemaDefinition } from "convex/server";
import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register this component with a `convex-test` instance so consuming apps can
 * test integration: `import { register } from "@vllnt/convex-comments/test"`.
 * Accepts the instance `convexTest(hostSchema, modules)` returns for any host
 * schema.
 *
 * @param t - The host app's `convex-test` instance.
 * @param name - The mount name (default `"comments"`, as in `app.use(component)`).
 */
export function register<TSchema extends GenericSchema>(
  t: TestConvex<SchemaDefinition<TSchema, boolean>>,
  name = "comments",
): void {
  t.registerComponent(name, schema, modules);
}
