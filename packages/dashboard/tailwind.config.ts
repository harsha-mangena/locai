import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        surface: "var(--color-surface)",
        "bubble-user": "var(--color-bubble-user)",
        "bubble-assistant": "var(--color-bubble-assistant)",
        thinking: "var(--color-thinking)",
        tool: "var(--color-tool)",
      },
    },
  },
  plugins: [],
} satisfies Config;
