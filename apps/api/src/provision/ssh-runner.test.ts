import { describe, it, expect } from "vitest";
import { buildRemoteCommand } from "./ssh-runner.js";

describe("SshRunner komut formatı", () => {
  it("sudo bayrağı 'sudo -n' öneki ekler", () => {
    expect(buildRemoteCommand("apt-get update", { sudo: true })).toBe("sudo -n apt-get update");
  });
  it("sudo yoksa komut aynen kalır", () => {
    expect(buildRemoteCommand("whoami")).toBe("whoami");
  });
});
