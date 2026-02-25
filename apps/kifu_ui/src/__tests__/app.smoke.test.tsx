import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";

jest.mock("../lib/mahjong_api", () => ({
  MAHJONG_API_BASE: "http://localhost:8000/analysis",
  postTenpai: jest.fn(async () => ({ ok: true, waits: [], shanten: 1 })),
  scoreWin: jest.fn(async () => ({ ok: false, error: "not-used-in-smoke" })),
  analyzeTilesFromImage: jest.fn(async () => ({ ok: false })),
  captureTilesFromImage: jest.fn(async () => ({ ok: false }))
}));

// import.meta.env 依存の副作用を避けるため、API層モック後にAppを読み込む
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { App } = require("../App") as { App: ComponentType };

describe("App (現状挙動の固定)", () => {
  test("初期表示で主要UIが表示される", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "手牌読込" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "流局" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ログ出力" })).toBeInTheDocument();

    expect(screen.getByDisplayValue("user1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("user2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("user3")).toBeInTheDocument();
    expect(screen.getByDisplayValue("user4")).toBeInTheDocument();

    expect(screen.getByText("東1局")).toBeInTheDocument();
  });
});
