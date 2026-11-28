import { defineComponent } from "convex/server";

/**
 * The comments component definition. Mount it in the host's `convex.config.ts`
 * with `app.use(component)`, or `app.use(component, { name })` for another
 * independent instance.
 */
const component = defineComponent("comments");

// Nest official child components here, e.g.:
// import aggregate from "@convex-dev/aggregate/convex.config";
// component.use(aggregate);

export default component;
