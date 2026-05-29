import type { Config } from "tailwindcss";

// Foldit — clean, neutral utility palette: cool dark surfaces, a single blue
// accent for actions, green for reclaimed space, amber/red for warnings.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        bg: {
          base: "#0b0d10",
          surface: "#12151b",
          panel: "#171b23",
          elevated: "#1e232d",
        },
        border: {
          subtle: "#1f242e",
          DEFAULT: "#2a313d",
          strong: "#3a4350",
        },
        ink: {
          base: "#e6e9ef",
          muted: "#9aa4b2",
          faint: "#5f6875",
        },
        accent: {
          DEFAULT: "#5b9dff",
          hover: "#7db0ff",
          save: "#34d399",
          warn: "#f5b14c",
          danger: "#f06a6a",
        },
      },
      borderRadius: {
        panel: "10px",
      },
    },
  },
  plugins: [],
} satisfies Config;
