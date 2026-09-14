import { reactive } from "vue";

export interface CharacterStateItem {
  id: string;
  name: string;
  role: string; // 主角 / 配角 / 敌对 / 盟友
  level: string; // 境界 / 等级 (如: 炼气五层, Lv.32, 实习调查员)
  equipment: string[]; // 装备 / 法宝 / 道具
  status: string; // 当前状态 / 伤势 / 心理
}

export interface ForeshadowingItem {
  id: string;
  chapter: string; // 埋下章节 (如: 第1章)
  content: string; // 伏笔要点 / 悬念线索
  status: "planted" | "progressing" | "resolved"; // 待回收 / 推进中 / 已回收
  resolvedChapter?: string; // 回收章节
  notes?: string; // 备注说明
}

export interface StoryContextItem {
  currentLocation: string; // 当前所处场景/地点
  timeProgress: string; // 时间线/推进进度
  factions: string; // 当前涉及势力格局
  coreConflict: string; // 当前核心矛盾冲突
  worldRules: string[]; // 核心世界观法则/设定禁忌
}

export interface StoryStateLedger {
  characters: CharacterStateItem[];
  foreshadowing: ForeshadowingItem[];
  context: StoryContextItem;
  keyPoints: string[]; // 关键要点备忘 (不丢失的重要线索)
  lastUpdatedChapter: string; // 最近同步的章节
  lastUpdatedAt: string;
}

const STORAGE_KEY = "auto_story_state_ledger_v1";

const defaultLedger: StoryStateLedger = {
  characters: [],
  foreshadowing: [],
  context: {
    currentLocation: "",
    timeProgress: "",
    factions: "",
    coreConflict: "",
    worldRules: [],
  },
  keyPoints: [],
  lastUpdatedChapter: "",
  lastUpdatedAt: "",
};

function loadLedger(): StoryStateLedger {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return JSON.parse(JSON.stringify(defaultLedger));
    const parsed = JSON.parse(raw);

    // 自动过滤历史版本注入的模板/模拟数据
    const rawChars = Array.isArray(parsed.characters) ? parsed.characters : [];
    const characters = rawChars.filter(
      (c: any) =>
        c &&
        c.id !== "char_main" &&
        !(c.name === "主角" && c.level === "初始境界" && Array.isArray(c.equipment) && c.equipment.includes("基础配剑"))
    );

    const rawRules = Array.isArray(parsed.context?.worldRules) ? parsed.context.worldRules : [];
    const worldRules = rawRules.filter(
      (r: string) =>
        r &&
        !r.includes("元婴以上威压") &&
        !r.includes("灵石为修真界通用货币")
    );

    const rawKeyPoints = Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [];
    const keyPoints = rawKeyPoints.filter(
      (k: string) => k && !k.includes("身负神秘玉佩")
    );

    const loc = parsed.context?.currentLocation ?? "";
    const currentLocation = loc.includes("青石镇") ? "" : loc;

    const time = parsed.context?.timeProgress ?? "";
    const timeProgress = time === "故事序幕" ? "" : time;

    const fac = parsed.context?.factions ?? "";
    const factions = fac.includes("暂未卷入宗门内斗") ? "" : fac;

    const conf = parsed.context?.coreConflict ?? "";
    const coreConflict = conf.includes("揭开身世之谜") ? "" : conf;

    return {
      characters,
      foreshadowing: Array.isArray(parsed.foreshadowing) ? parsed.foreshadowing : [],
      context: {
        currentLocation,
        timeProgress,
        factions,
        coreConflict,
        worldRules,
      },
      keyPoints,
      lastUpdatedChapter: parsed.lastUpdatedChapter || "",
      lastUpdatedAt: parsed.lastUpdatedAt || "",
    };
  } catch {
    return JSON.parse(JSON.stringify(defaultLedger));
  }
}

function saveLedger(ledger: StoryStateLedger) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  } catch {
    // ignore
  }
}

export const storyStateStore = reactive({
  ledger: loadLedger(),

  save() {
    this.ledger.lastUpdatedAt = new Date().toLocaleString();
    saveLedger(this.ledger);
  },

  reset() {
    this.ledger = JSON.parse(JSON.stringify(defaultLedger));
    this.save();
  },

  addCharacter(char: Omit<CharacterStateItem, "id">) {
    const item: CharacterStateItem = {
      ...char,
      id: "char_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
    };
    this.ledger.characters.push(item);
    this.save();
    return item;
  },

  updateCharacter(id: string, partial: Partial<CharacterStateItem>) {
    const item = this.ledger.characters.find((c) => c.id === id);
    if (item) {
      Object.assign(item, partial);
      this.save();
    }
  },

  removeCharacter(id: string) {
    this.ledger.characters = this.ledger.characters.filter((c) => c.id !== id);
    this.save();
  },

  addForeshadowing(item: Omit<ForeshadowingItem, "id">) {
    const f: ForeshadowingItem = {
      ...item,
      id: "fore_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5),
    };
    this.ledger.foreshadowing.push(f);
    this.save();
    return f;
  },

  updateForeshadowing(id: string, partial: Partial<ForeshadowingItem>) {
    const item = this.ledger.foreshadowing.find((f) => f.id === id);
    if (item) {
      Object.assign(item, partial);
      this.save();
    }
  },

  removeForeshadowing(id: string) {
    this.ledger.foreshadowing = this.ledger.foreshadowing.filter((f) => f.id !== id);
    this.save();
  },

  addKeyPoint(text: string) {
    const trimmed = text.trim();
    if (trimmed && !this.ledger.keyPoints.includes(trimmed)) {
      this.ledger.keyPoints.push(trimmed);
      this.save();
    }
  },

  removeKeyPoint(index: number) {
    this.ledger.keyPoints.splice(index, 1);
    this.save();
  },

  addWorldRule(rule: string) {
    const trimmed = rule.trim();
    if (trimmed && !this.ledger.context.worldRules.includes(trimmed)) {
      this.ledger.context.worldRules.push(trimmed);
      this.save();
    }
  },

  removeWorldRule(index: number) {
    this.ledger.context.worldRules.splice(index, 1);
    this.save();
  },

  /**
   * 格式化状态表为结构化文本，在 AI 起草新章前注入提示词
   * 确保等级、装备、伏笔与当前要点在写一百章也不混乱
   */
  formatStatePromptForChapter(): string {
    const activeForeshadows = this.ledger.foreshadowing.filter(
      (f) => f.status === "planted" || f.status === "progressing"
    );
    const ctx = this.ledger.context;
    const hasContext = Boolean(
      ctx.currentLocation || ctx.timeProgress || ctx.coreConflict || ctx.factions
    );
    const hasRules = ctx.worldRules.length > 0 || this.ledger.keyPoints.length > 0;

    // 若状态表中没有任何自定义状态与线索，则不注入空模板
    if (
      this.ledger.characters.length === 0 &&
      activeForeshadows.length === 0 &&
      !hasContext &&
      !hasRules
    ) {
      return "";
    }

    const lines: string[] = [];
    lines.push("【故事全局追踪状态表（写前必读，严禁设定冲突）】：");

    // 1. 角色状态与等级装备
    if (this.ledger.characters.length > 0) {
      lines.push("● 核心角色状态与等级装备：");
      for (const c of this.ledger.characters) {
        const equipStr = c.equipment && c.equipment.length > 0 ? c.equipment.join("、") : "无特殊装备";
        lines.push(
          `  - ${c.name}（${c.role}）：当前等级/境界【${c.level}】，装备/法宝【${equipStr}】，当前状态【${c.status}】`
        );
      }
    }

    // 2. 活跃伏笔与暗线 (仅注入待回收与推进中的伏笔，避免干扰)
    if (activeForeshadows.length > 0) {
      lines.push("● 活跃未解伏笔与暗线库（请在情节推进中有意识呼应或借力）：");
      for (const f of activeForeshadows) {
        const statusText = f.status === "planted" ? "待推进" : "推进中";
        lines.push(`  - [${statusText}·源自${f.chapter}] ${f.content}`);
      }
    }

    // 3. 当前上下文要点
    if (hasContext) {
      lines.push("● 当前场景与局势上下文：");
      if (ctx.currentLocation) lines.push(`  - 当前地点：${ctx.currentLocation}`);
      if (ctx.timeProgress) lines.push(`  - 时间推进：${ctx.timeProgress}`);
      if (ctx.coreConflict) lines.push(`  - 核心矛盾：${ctx.coreConflict}`);
      if (ctx.factions) lines.push(`  - 阵营关系：${ctx.factions}`);
    }

    // 4. 世界观法则与关键备忘
    if (hasRules) {
      lines.push("● 关键法则与重要设定备忘：");
      for (const r of ctx.worldRules) {
        lines.push(`  - 规则：${r}`);
      }
      for (const k of this.ledger.keyPoints) {
        lines.push(`  - 要点：${k}`);
      }
    }

    lines.push(
      "【状态表约束】：起草新正文时，角色等级、装备、未解伏笔必须与上述状态表严格一致，严禁出现等级倒退、凭空出现未获得装备或设定自相矛盾的情形。"
    );

    return lines.join("\n");
  },

  /**
   * 单章写完后，自动根据正文内容做轻量级启发式分析与状态更新
   */
  autoUpdateStoryStateFromChapter(chapterContent: string, chapterTitle: string) {
    if (!chapterContent || chapterContent.length < 50) return;
    this.ledger.lastUpdatedChapter = chapterTitle || "最新章节";

    // 1. 扫描是否有突破/升级关键词
    const levelMatch = chapterContent.match(
      /(突破(?:至|到|成)?|晋级(?:至|到)?|踏入|跨入|升到|达到)([^\n，。？！]{2,10}(?:层|期|境|重|级|阶))/
    );
    if (levelMatch && levelMatch[2]) {
      const newLevel = levelMatch[2].trim();
      let mainChar = this.ledger.characters.find((c) => c.role === "主角") || this.ledger.characters[0];
      if (mainChar) {
        if (!mainChar.level.includes(newLevel)) {
          mainChar.level = newLevel;
        }
      } else {
        this.addCharacter({
          name: "主角",
          role: "主角",
          level: newLevel,
          equipment: [],
          status: "正常",
        });
      }
    }

    // 2. 扫描新获得装备/道具 (得、捡到、赐予、炼化、拾得 + 法宝/剑/甲/丹/符)
    const equipMatch = chapterContent.match(
      /(?:获得|得到|捡到|炼制出|炼化|赏赐|佩戴|收下|换上)([^\n，。？！]{2,8}(?:剑|刀|弓|甲|袍|戒|印|鼎|珠|令|丹|符|镜|靴))/g
    );
    if (equipMatch) {
      let mainChar = this.ledger.characters.find((c) => c.role === "主角") || this.ledger.characters[0];
      if (!mainChar) {
        mainChar = this.addCharacter({
          name: "主角",
          role: "主角",
          level: "初始境界",
          equipment: [],
          status: "正常",
        });
      }
      for (const m of equipMatch) {
        const cleanItem = m.replace(/^(?:获得|得到|捡到|炼制出|炼化|赏赐|佩戴|收下|换上)/, "").trim();
        if (cleanItem && !mainChar.equipment.includes(cleanItem)) {
          mainChar.equipment.push(cleanItem);
        }
      }
    }

    // 3. 扫描伏笔线索词 (隐隐觉得、暗暗记下、埋下、伏笔、未解、神秘符号、异样)
    const clueMatch = chapterContent.match(
      /([^\n。？！]{0,15}(?:暗藏|隐隐觉得|暗自心惊|神秘符号|异常之处|留下悬念|不为人知)[^\n。？！]{0,25})/
    );
    if (clueMatch && clueMatch[1]) {
      const clue = clueMatch[1].trim();
      const exists = this.ledger.foreshadowing.some((f) => f.content.includes(clue.slice(0, 10)));
      if (!exists && clue.length >= 8) {
        this.addForeshadowing({
          chapter: chapterTitle || "新章节",
          content: clue,
          status: "planted",
          notes: "正文自动提取",
        });
      }
    }

    this.save();
  },
});
