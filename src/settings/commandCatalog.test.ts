// @vitest-environment node
import { describe, it, expect } from "vitest";
import { CommandRegistry } from "@/commands/CommandRegistry";
import { buildCommandCatalog, catalogCommandIds, SettingCommandItem } from "./commandCatalog";

function makeRegistry(): CommandRegistry {
    const registry = new CommandRegistry();
    registry.registerMany([
        { id: "tabs.previous", title: "cmdTabsPrevious", group: "Tabs", execute: () => ({ status: "executed" as const }) },
        { id: "tabs.next", title: "cmdTabsNext", group: "Tabs", execute: () => ({ status: "executed" as const }) },
        { id: "scroll.top", title: "cmdScrollTop", group: "Scrolling", execute: () => ({ status: "executed" as const }) },
    ]);
    return registry;
}

describe("commandCatalog", () => {
    it("目录只包含只读元数据（id/titleKey/title/group/groupTitle），不包含 execute", () => {
        const catalog = buildCommandCatalog(makeRegistry(), { cmdTabsNext: "下一个标签页" });
        expect(catalog).toHaveLength(3);
        for (const item of catalog) {
            expect(Object.keys(item).sort()).toEqual(["group", "groupTitle", "id", "title", "titleKey"]);
            expect(item).not.toHaveProperty("execute");
        }
    });

    it("分组标题使用 i18n 解析，缺失时回退原始 group id", () => {
        const catalog = buildCommandCatalog(makeRegistry(), { cmdGroupTabs: "标签页" });
        const next = catalog.find((c) => c.id === "tabs.next");
        expect(next?.groupTitle).toBe("标签页");
        expect(next?.group).toBe("Tabs"); // runtime group id unchanged
        const scroll = catalog.find((c) => c.group === "Scrolling");
        expect(scroll?.groupTitle).toBe("Scrolling"); // no i18n key → fallback
    });

    it("标题使用 i18n 解析，缺失时回退 titleKey", () => {
        const catalog = buildCommandCatalog(makeRegistry(), { cmdTabsNext: "下一个标签页" });
        const next = catalog.find((c) => c.id === "tabs.next");
        expect(next?.title).toBe("下一个标签页");
        expect(next?.titleKey).toBe("cmdTabsNext");
        const prev = catalog.find((c) => c.id === "tabs.previous");
        expect(prev?.title).toBe("cmdTabsPrevious"); // no i18n key → fallback
    });

    it("catalogCommandIds 提取 id 集合", () => {
        const catalog: SettingCommandItem[] = [
            { id: "tabs.next", titleKey: "k", title: "t", group: "G", groupTitle: "G" },
        ];
        const ids = catalogCommandIds(catalog);
        expect(ids.has("tabs.next")).toBe(true);
        expect(ids.has("nope")).toBe(false);
    });

    it("目录与运行时注册命令一致（同一 registry 来源）", () => {
        const registry = makeRegistry();
        const catalog = buildCommandCatalog(registry, {});
        const registryIds = new Set(registry.list().map((c) => c.id));
        expect(catalogCommandIds(catalog)).toEqual(registryIds);
    });
});
