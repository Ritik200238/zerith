import type { Config } from "tailwindcss";

/**
 * Zerith editorial light theme.
 * CSS variables live in src/app/globals.css. This config maps them
 * into Tailwind so utilities like `bg-bg`, `text-text`, `border-borderDash`,
 * `font-display`, `font-serif`, `font-mono` work out of the box.
 */
const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/providers/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/hooks/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Editorial palette
        bg: "var(--bg)",
        bgAlt: "var(--bg-alt)",
        bgCard: "var(--bg-card)",
        bgCardHover: "var(--bg-card-hover)",
        text: "var(--text)",
        textSecondary: "var(--text-secondary)",
        textMuted: "var(--text-muted)",
        "border-default": "var(--border)",
        borderDash: "var(--border-dash)",
        accent1: "var(--accent-1)",
        accent2: "var(--accent-2)",
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",

        // Legacy aliases kept so unswept pages do not break.
        // Map "dark" tokens to editorial tokens — the page-sweep
        // agent will replace these one by one.
        "bg-primary": "var(--bg)",
        "bg-secondary": "var(--bg-alt)",
        "bg-card": "var(--bg-card)",
        "bg-card-hover": "var(--bg-card-hover)",
        "accent-purple": "var(--accent-2)",
        "accent-blue": "#4F4ACD",
        "accent-cyan": "var(--accent-1)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"], // default
      },
      borderRadius: {
        DEFAULT: "4px",
        btn: "8px",
      },
      maxWidth: {
        container: "1180px",
      },
      transitionTimingFunction: {
        ease: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
