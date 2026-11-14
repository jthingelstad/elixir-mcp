/**
 * Profile images in the kit (2026-11-14): the Avatar's picture variant
 * (the crop table's own pins are avatar-crops.test.js, in plain
 * JavaScript because the kit's typecheck has no Node types): the mirror's base art in a plain circle, initials when
 * there is no image or the art fails, nothing but a card number ever in
 * the address.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import {
  AccountAvatar,
  Avatar,
  PlayerIdentityProvider,
  PlayerName,
  avatarCardOf,
  avatarCrop,
} from "../src/index.ts";

afterEach(cleanup);

describe("Avatar's picture", () => {
  test("the card's base art, cropped by CSS variables, hidden from readers", () => {
    const { container } = render(
      <Avatar name="Invented Lark" tag="#0PRJ8Y2C" card={26000000} large />,
    );
    const el = container.querySelector(".kit-av")!;
    expect(el.className).toMatch(/kit-av--image/);
    expect(el.className).toMatch(/kit-av--l/);
    expect(el.getAttribute("aria-hidden")).toBe("true");
    const img = el.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/assets/cards/26000000.png");
    expect(img.getAttribute("alt")).toBe("");
    const style = (el as HTMLElement).style;
    const crop = avatarCrop(26000000);
    expect(style.getPropertyValue("--avatar-x")).toBe(`${crop.x}%`);
    expect(style.getPropertyValue("--avatar-scale")).toBe(String(crop.scale));
    expect(el.textContent).toBe("");
  });

  test("no image, initials", () => {
    const { container } = render(<Avatar name="Invented Lark" card={null} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("IL");
  });

  test("the art fails to load: the initials come back", () => {
    const { container } = render(
      <Avatar name="Invented Lark" card={26000000} small />,
    );
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    const el = container.querySelector(".kit-av")!;
    expect(el.className).not.toMatch(/kit-av--image/);
    expect(el.className).toMatch(/kit-av--s/);
    expect(el.textContent).toBe("IL");
  });

  test("a tower troop, a clan and a hostile id draw no picture", () => {
    for (const card of [
      159000000,
      -1,
      1.5,
      Number.NaN,
      '"><script>alert(1)</script>',
      "26000000",
      { id: 1 },
    ] as unknown[]) {
      expect(avatarCardOf(card)).toBeNull();
      const { container } = render(
        <Avatar name="<b>Hostile</b>" card={card as number} />,
      );
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("script, b")).toBeNull();
      cleanup();
    }
    const clan = render(<Avatar name="POAP KINGS" clan card={26000000} />);
    expect(clan.container.querySelector("img")).toBeNull();
  });
});

describe("AccountAvatar", () => {
  test("the account's own image in the bar, initials when none or when it fails", () => {
    const { container, rerender } = render(
      <AccountAvatar card={26000000} initials="KT" large />,
    );
    const el = container.querySelector(".chrome__avatar")!;
    expect(el.className).toMatch(/chrome__avatar--image/);
    expect(el.className).toMatch(/chrome__avatar--lg/);
    fireEvent.error(el.querySelector("img")!);
    expect(container.querySelector(".chrome__avatar")!.textContent).toBe("KT");
    rerender(<AccountAvatar card={null} initials="KT" />);
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("verified player identity", () => {
  test("proof survives missing and failed art; neither art nor a clan can imply it", () => {
    const draw = (verified: boolean, card: number | null) => (
      <PlayerIdentityProvider players={{ "#00C298UC": verified }}>
        <Avatar name="Ada" tag="#00C298UC" card={card} />
        <PlayerName tag="#00C298UC">Ada</PlayerName>
        <Avatar name="Grove" tag="#00C298UC" clan />
      </PlayerIdentityProvider>
    );
    const { container, rerender, queryByRole } = render(draw(true, null));
    expect(container.querySelectorAll(".kit-av--verified")).toHaveLength(1);
    expect(queryByRole("img", { name: "Verified player" })).not.toBeNull();
    rerender(draw(true, 26000000));
    fireEvent.error(container.querySelector(".kit-av img")!);
    expect(container.querySelector(".kit-av--verified")!.textContent).toBe(
      "AD",
    );
    expect(queryByRole("img", { name: "Verified player" })).not.toBeNull();
    rerender(draw(false, 26000001));
    expect(container.querySelector(".kit-av--verified")).toBeNull();
    expect(queryByRole("img", { name: "Verified player" })).toBeNull();
  });
});
