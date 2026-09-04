import { describe, expect, it } from "vitest";
import { joinContinuation, looksUnfinished } from "./agentRunner";
import { isContinueRequest } from "./chatSlashCommands";

describe("isContinueRequest", () => {
  it("认得各种「接着写」的说法", () => {
    for (const s of [
      "继续",
      "请继续",
      "继续。",
      "继续，",
      "继续吧",
      "那继续",
      "接着写",
      "接着说",
      "接着写。",
      "继续写",
      "继续写完",
      "继续输出",
      "接下来写",
      "往下写",
      "写下去",
      "接上文",
      "续写",
      "没写完",
      "还没写完",
      "被截断了",
      "断了",
      "帮我继续写",
      "continue",
      "go on",
      "keep going",
    ]) {
      expect(isContinueRequest(s), s).toBe(true);
    }
  });

  it("带着新需求的「继续……」不算续写", () => {
    for (const s of [
      "继续讲讲这个话题",
      "继续帮我改第三段",
      "继续写一篇新的小红书文案",
      "继续保持这个风格再写一篇关于秋天的短文",
      "你觉得这段怎么样",
      "重新写一遍",
      "换个风格写",
      "/身份模板 帮我写300字",
      "把上面的内容总结一下",
      "帮我写一段300字的校园甜宠",
      "好的",
      "谢谢",
      "这段不错",
      "",
    ]) {
      expect(isContinueRequest(s), s).toBe(false);
    }
  });
});

describe("looksUnfinished", () => {
  const long =
    "他站起来，拍了拍身上的灰，然后头也不回地走了，屋外的风把门帘掀起来一角，" +
    "他没有回头，只是把手插进兜里，慢慢地往巷子深处走，脚步声在青石板上敲出很轻的回响，" +
    "像有人在数着他还剩多少路。巷口那家早点铺的蒸笼刚揭开，白汽扑到他脸上，他眯了下眼，" +
    "又往前走，走得比刚才更快一些，好像身后有什么正在追上来，可他心里其实清楚，追他的从来只有";

  it("长正文断在半句里 → 判定未写完", () => {
    expect(looksUnfinished(long)).toBe(true);
  });

  it("以句末标点 / 省略号 / 右引号收尾 → 判定已写完", () => {
    expect(looksUnfinished(long.slice(0, 200) + "。")).toBe(false);
    expect(looksUnfinished(long.slice(0, 200) + "……")).toBe(false);
    expect(looksUnfinished(long.slice(0, 200) + "他说完就走了。”")).toBe(false);
  });

  it("话题标签结尾（小红书体）→ 判定已写完", () => {
    expect(looksUnfinished(long.slice(0, 200) + "\n#秋日穿搭 #巷子里的风")).toBe(false);
  });

  it("短回复一律不判为截断", () => {
    expect(looksUnfinished("好的，我明白了")).toBe(false);
    expect(looksUnfinished("短回答。")).toBe(false);
    expect(looksUnfinished("")).toBe(false);
  });

  it("多行清单最后一项没写完 → 判定未写完", () => {
    const list = Array.from({ length: 8 }, (_, i) => `第 ${i + 1} 点：这一条写得稍微长一些`).join("\n");
    expect(looksUnfinished(list)).toBe(true);
  });
});

describe("joinContinuation", () => {
  it("剪掉模型重复抄写的搭接文字", () => {
    expect(joinContinuation("他站起来，拍了拍身上的灰，", "拍了拍身上的灰，然后头也不回地走了。")).toBe(
      "他站起来，拍了拍身上的灰，然后头也不回地走了。",
    );
    expect(joinContinuation("他把门推开，屋里一片漆黑，只有窗", "只有窗外一点路灯的光。")).toBe(
      "他把门推开，屋里一片漆黑，只有窗外一点路灯的光。",
    );
  });

  it("剪掉「好的，我继续。」这类交代性开场", () => {
    expect(joinContinuation("前半段正文到这里断了", "好的，我继续。\n后半段接上来了。")).toBe(
      "前半段正文到这里断了后半段接上来了。",
    );
    expect(joinContinuation("前半段正文到这里断了", "接上文：\n后半段接上来了。")).toBe(
      "前半段正文到这里断了后半段接上来了。",
    );
  });

  it("没有重叠时原样拼接", () => {
    expect(joinContinuation("前半段正文到这里断了", "后半段直接接上来")).toBe(
      "前半段正文到这里断了后半段直接接上来",
    );
  });

  it("前文为空时只做去噪", () => {
    expect(joinContinuation("", "从零开始写的内容")).toBe("从零开始写的内容");
  });

  it("整段都是交代话时不会把正文吃空", () => {
    const out = joinContinuation("前文", "继续");
    expect(out.length).toBeGreaterThan("前文".length - 1);
  });
});
