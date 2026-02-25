import { render, screen } from "@testing-library/react";
import { App } from "../App";

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

    expect(screen.getByText("ルール :")).toBeInTheDocument();
    expect(screen.getByText("般南喰赤")).toBeInTheDocument();
  });
});
