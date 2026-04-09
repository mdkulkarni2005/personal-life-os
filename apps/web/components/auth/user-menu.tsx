"use client";

import { UserButton } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import { useMemo } from "react";

export function UserMenu() {
  const { theme, setTheme } = useTheme();

  const toggleLabel = useMemo(
    () => (theme === "dark" ? "Switch to light theme" : "Switch to dark theme"),
    [theme]
  );

  const handleToggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Action
          label={toggleLabel}
          labelIcon={<span aria-hidden>◐</span>}
          onClick={handleToggleTheme}
        />
      </UserButton.MenuItems>
    </UserButton>
  );
}
