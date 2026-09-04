import { reactive } from "vue";

/**
 * Shared local-font discovery.
 *
 * The settings panel (配置 → 字体) and the document toolbar font picker both
 * read from the same reactive state so the two lists can never drift apart.
 */

export const COMMON_SYSTEM_FONTS = [
  "Microsoft YaHei",
  "微软雅黑",
  "SimHei",
  "黑体",
  "SimSun",
  "宋体",
  "KaiTi",
  "楷体",
  "FangSong",
  "仿宋",
  "Microsoft JhengHei",
  "微软正黑体",
  "PingFang SC",
  "苹方-简",
  "Hiragino Sans GB",
  "冬青黑体",
  "STHeiti",
  "华文黑体",
  "STKaiti",
  "华文楷体",
  "STSong",
  "华文宋体",
  "STFangsong",
  "华文仿宋",
  "Source Han Sans SC",
  "思源黑体",
  "Source Han Serif SC",
  "思源宋体",
  "Noto Sans SC",
  "Noto Serif SC",
  "DFKai-SB",
  "标楷体",
  "Arial",
  "Arial Black",
  "Calibri",
  "Cambria",
  "Comic Sans MS",
  "Consolas",
  "Courier New",
  "Georgia",
  "Impact",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Cascadia Code",
  "JetBrains Mono",
  "Fira Code",
  "Monaco",
  "Menlo",
];

export const fontState = reactive({
  localFonts: [] as string[],
  loading: false,
  error: false,
});

/** Canvas width-probe fallback used when `queryLocalFonts` is unavailable. */
export function isFontInstalled(fontName: string): boolean {
  if (typeof document === "undefined") return false;
  const baseFonts = ["monospace", "sans-serif", "serif"];
  const testString = "mmmmmmmmmlli11111WWWWWWWWWW永和九年岁在癸丑";
  const testSize = "72px";

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return false;

  const baselineWidths: Record<string, number> = {};
  for (const baseFont of baseFonts) {
    context.font = `${testSize} ${baseFont}`;
    baselineWidths[baseFont] = context.measureText(testString).width;
  }

  for (const baseFont of baseFonts) {
    context.font = `${testSize} '${fontName}', ${baseFont}`;
    const width = context.measureText(testString).width;
    if (width !== baselineWidths[baseFont]) {
      return true;
    }
  }
  return false;
}

let inFlight: Promise<void> | null = null;

export async function loadLocalFonts(force = false): Promise<void> {
  if (!force && fontState.localFonts.length > 0) return;
  if (inFlight) return inFlight;

  fontState.loading = true;
  fontState.error = false;

  inFlight = (async () => {
    const fontNames = new Set<string>();

    const queryLocalFonts = (window as unknown as { queryLocalFonts?: () => Promise<{ family?: string }[]> })
      .queryLocalFonts;

    if (typeof queryLocalFonts === "function") {
      try {
        const fonts = await queryLocalFonts();
        for (const f of fonts) {
          if (f.family) fontNames.add(f.family);
        }
      } catch {
        /* Permission denied / unsupported — fall through to detection. */
      }
    }

    if (fontNames.size === 0) {
      for (const fontName of COMMON_SYSTEM_FONTS) {
        if (isFontInstalled(fontName)) fontNames.add(fontName);
      }
    }

    const result = Array.from(fontNames).sort((a, b) => a.localeCompare(b, "zh-CN"));
    fontState.localFonts = result;
    fontState.error = result.length === 0;
    fontState.loading = false;
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Ensure the fonts list is populated without blocking the caller. */
export function ensureLocalFonts(): void {
  if (fontState.localFonts.length === 0 && !fontState.loading) {
    void loadLocalFonts();
  }
}
