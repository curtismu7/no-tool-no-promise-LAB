import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ModeToggle from "../components/ModeToggle.jsx";

test("local, mock only: Mock is pressed and Real is disabled with the reason", () => {
  render(<ModeToggle info={{ source: "mock", realAvailable: false }} onSelect={() => {}} />);
  expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("mode-real")).toBeDisabled();
  expect(screen.getByTestId("mode-real")).toHaveAttribute("title", expect.stringMatching(/no live version/));
});

test("when Real is available the buttons switch both ways and the pressed one does nothing", () => {
  const picked = [];
  const { rerender } = render(<ModeToggle info={{ source: "mock", realAvailable: true }} onSelect={(s) => picked.push(s)} />);
  fireEvent.click(screen.getByTestId("mode-mock"));
  expect(picked).toEqual([]);
  fireEvent.click(screen.getByTestId("mode-real"));
  expect(picked).toEqual(["real"]);
  rerender(<ModeToggle info={{ source: "real", realAvailable: true }} onSelect={(s) => picked.push(s)} />);
  expect(screen.getByTestId("mode-real")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByTestId("mode-mock"));
  expect(picked).toEqual(["real", "mock"]);
});

test("before the server answers both buttons are disabled", () => {
  render(<ModeToggle info={null} onSelect={() => {}} />);
  expect(screen.getByTestId("mode-mock")).toBeDisabled();
  expect(screen.getByTestId("mode-real")).toBeDisabled();
});
