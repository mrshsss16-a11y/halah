import { createApp } from "./http/app";
import type { HalaBindings } from "./http/types";

const app = createApp();

export default {
  fetch: app.fetch
} satisfies ExportedHandler<HalaBindings>;
