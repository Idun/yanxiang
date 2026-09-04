import { describe, expect, it } from "vitest";
import { contentKey, mergeRefined } from "./refinePunctuation";

const O = "他站起来，拍了拍身上的灰。";

describe("contentKey", () => {
  it("剔掉标点与空白后逐字比较", () => {
    expect(contentKey("他站起来，拍了拍身上的灰。")).toBe("他站起来拍了拍身上的灰");
    expect(contentKey("他站起来,拍了拍身上的灰.")).toBe(contentKey(O));
    expect(contentKey("他起身，掸掉身上的灰。")).not.toBe(contentKey(O));
  });
});

describe("mergeRefined · 退回原文的四种情形", () => {
  it("模型原样照抄 → verbatim", () => {
    const r = mergeRefined(O, O);
    expect(r.outcome).toBe("verbatim");
    expect(r.text).toBe(O);
  });

  it("只换了标点写法 → punct-only，一个符号都不动", () => {
    const r = mergeRefined(O, "他站起来,拍了拍身上的灰.");
    expect(r.outcome).toBe("punct-only");
    expect(r.text).toBe(O);
  });

  it("空行 / 只回标点 → empty", () => {
    expect(mergeRefined(O, "").outcome).toBe("empty");
    expect(mergeRefined(O, "   ").outcome).toBe("empty");
    expect(mergeRefined(O, "，。").outcome).toBe("empty");
  });

  it("过度扩写（把解释也写进来了）→ runaway", () => {
    const bloated =
      "他起身，掸掉身上的灰。这句改写得更口语一些，因为原文用词偏书面，" +
      "这样读起来更自然，也更符合中文的表达习惯，希望你满意，如果还要调整请告诉我。";
    const r = mergeRefined(O, bloated);
    expect(r.outcome).toBe("runaway");
    expect(r.text).toBe(O);
  });
});

describe("mergeRefined · 甲档原位合并", () => {
  it("改内容、保标点 → merged，标点完全按原文", () => {
    const r = mergeRefined(O, "他起身，掸掉身上的灰。");
    expect(r.outcome).toBe("merged");
    expect(r.text).toBe("他起身，掸掉身上的灰。");
  });

  it("模型丢了句末句号 → 按原文补回", () => {
    const r = mergeRefined(O, "他起身，掸掉身上的灰");
    expect(r.outcome).toBe("merged");
    expect(r.text).toBe("他起身，掸掉身上的灰。");
  });

  it("模型自己新增的标点被丢弃", () => {
    const r = mergeRefined(O, "他起身，掸了掸灰，拍拍裤子。");
    expect(r.outcome).toBe("merged");
    /* 原文只有一个逗号，多出来的那个不予采纳。 */
    expect((r.text.match(/，/g) ?? []).length).toBe(1);
  });

  it("markdown 噪声不会混进正文", () => {
    const r = mergeRefined(O, "**他起身，掸掉身上的灰。**");
    expect(r.text).toBe("他起身，掸掉身上的灰。");
    expect(r.text).not.toContain("*");
  });

  it("半角引号被拉回原文的全角写法", () => {
    const orig = "他说：“走吧。”";
    const r = mergeRefined(orig, '他说:"那就走。"');
    expect(r.text).toBe("他说：“那就走。”");
  });

  it("首尾空白（段落换行）原样保留", () => {
    const r = mergeRefined("\n\n他站起来，拍了拍身上的灰。\n", "他起身，掸掉身上的灰。");
    expect(r.text).toBe("\n\n他起身，掸掉身上的灰。\n");
  });
});

describe("mergeRefined · 乙档降级采纳（关键回归）", () => {
  it("删掉分句逗号 + 两个分句都改 → 不再整句退回，而是降级采纳", () => {
    const r = mergeRefined(O, "他起身掸掉身上的灰。");
    expect(r.outcome).toBe("relaxed");
    expect(r.text).toBe("他起身掸掉身上的灰。");
  });

  it("逗号改句号（拆句）→ 降级采纳，采用模型的断句", () => {
    const r = mergeRefined(O, "他起身。掸掉身上的灰。");
    expect(r.outcome).toBe("relaxed");
    expect(r.text).toBe("他起身。掸掉身上的灰。");
  });

  it("三分句合并重写 → 降级采纳", () => {
    const orig = "他站起来，拍了拍身上的灰，然后头也不回地走了。";
    const r = mergeRefined(orig, "他起身掸掉灰，头也不回就走。");
    expect(r.outcome).toBe("relaxed");
    expect(r.text).toBe("他起身掸掉灰，头也不回就走。");
  });

  it("降级时把标点写法归一回原文风格", () => {
    const r = mergeRefined(O, "他起身掸掉灰,顺手拍了裤子.");
    expect(r.text).not.toContain(",");
    expect(r.text).not.toMatch(/\.$/);
  });

  it("降级后句末标点必须与原文一致（保住整篇的句子边界）", () => {
    const cases: [string, string][] = [
      [O, "他起身掸掉身上的灰"],
      [O, "他起身。掸掉身上的灰"],
      ["他站起来，拍了拍身上的灰！", "他起身掸掉灰。"],
      ["真的吗？", "真不至于吧。"],
    ];
    for (const [orig, model] of cases) {
      const r = mergeRefined(orig, model);
      const tail = orig.match(/[。！？!?.]+$/)?.[0] ?? "";
      expect(r.text.endsWith(tail), `${orig} -> ${r.text}`).toBe(true);
    }
  });
});

describe("mergeRefined · 批量采纳率（这次重构的核心指标）", () => {
  const pool = Array.from("他她走站看说想笑哭跑跳灰土风雨门窗屋路巷影光声手脚眼眉衣袖");
  let seed = 20260902;
  const rnd = () => {
    /* 固定种子的线性同余，保证测试可复现。 */
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  const makeSentence = (nClause: number) =>
    Array.from({ length: nClause }, () =>
      Array.from({ length: 4 + Math.floor(rnd() * 6) }, () => pick(pool)).join(""),
    ).join("，") + "。";

  /** 模拟模型改写：每个分句换掉约四成字，再按 mode 调整断句。 */
  const rewrite = (sentence: string, mode: "keep" | "drop" | "split") => {
    const parts = sentence.slice(0, -1).split("，");
    const edited = parts.map((p) => {
      const chars = Array.from(p);
      const k = Math.max(1, Math.floor(chars.length * 0.4));
      for (let i = 0; i < k; i++) chars[Math.floor(rnd() * chars.length)] = pick(pool);
      return chars.join("");
    });
    if (mode === "keep" || edited.length < 2) return edited.join("，") + "。";
    const i = Math.floor(rnd() * (edited.length - 1));
    if (mode === "drop") {
      const merged = edited.slice();
      merged.splice(i, 2, edited[i] + edited[i + 1]);
      return merged.join("，") + "。";
    }
    return edited.slice(0, i + 1).join("，") + "。" + edited.slice(i + 1).join("，") + "。";
  };

  it.each(["keep", "drop", "split"] as const)(
    "模型动手改（断句方式=%s）时，采纳率应为 100%%",
    (mode) => {
      let accepted = 0;
      const N = 600;
      for (let i = 0; i < N; i++) {
        const s = makeSentence(2 + Math.floor(rnd() * 3));
        const r = mergeRefined(s, rewrite(s, mode));
        if (r.text !== s) accepted++;
      }
      expect(accepted).toBe(N);
    },
  );

  it("混合场景下句末标点一律与原文一致", () => {
    const modes = ["keep", "drop", "split"] as const;
    for (let i = 0; i < 900; i++) {
      const s = makeSentence(2 + Math.floor(rnd() * 3));
      const r = mergeRefined(s, rewrite(s, pick([...modes])));
      expect(r.text.slice(-1), `${s} -> ${r.text}`).toBe(s.slice(-1));
    }
  });

  it("模型全程照抄时，采纳率为 0（不虚报修订）", () => {
    for (let i = 0; i < 200; i++) {
      const s = makeSentence(2 + Math.floor(rnd() * 3));
      const r = mergeRefined(s, s);
      expect(r.outcome).toBe("verbatim");
      expect(r.text).toBe(s);
    }
  });
});
