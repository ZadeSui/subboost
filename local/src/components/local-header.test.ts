import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanup: undefined as void | (() => void),
  header: vi.fn(),
  setState: vi.fn(),
  stateValue: null as unknown,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      mocks.cleanup = effect();
    },
    useState: (initial: unknown) => [mocks.stateValue ?? initial, mocks.setState],
  };
});

vi.mock("@subboost/ui/components/layout/header", async () => {
  const actualReact = await vi.importActual<typeof import("react")>("react");
  return {
    Header: (props: { mode: string; extraBrandBadge?: unknown }) => {
      mocks.header(props);
      return actualReact.createElement("header", null, props.extraBrandBadge ? "badge" : "none");
    },
  };
});

import { LocalHeader } from "./local-header";

function renderHeader() {
  return renderToStaticMarkup(React.createElement(LocalHeader));
}

async function flushAsyncWork() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("LocalHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.cleanup = undefined;
    mocks.stateValue = null;
  });

  it("loads a new release badge when the local release is behind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            hasUpdate: true,
            latestTag: "v9.8.7",
            releaseUrl: "https://github.com/SubBoost/subboost/releases/tag/v9.8.7",
          })
        )
      )
    );

    expect(renderHeader()).toContain("none");
    await flushAsyncWork();

    expect(fetch).toHaveBeenCalledWith(
      "/api/releases/latest",
      { signal: expect.any(AbortSignal) }
    );
    expect(mocks.setState).toHaveBeenCalledWith({
      label: "new",
      href: "https://github.com/SubBoost/subboost/releases/tag/v9.8.7",
      external: true,
      title: "SubBoost v9.8.7 已发布",
      ariaLabel: "SubBoost v9.8.7 已发布",
    });
  });

  it("uses a generic badge title when GitHub does not return a release tag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            hasUpdate: true,
            latestTag: " ",
            releaseUrl: "https://github.com/SubBoost/subboost/releases/latest",
          })
        )
      )
    );

    renderHeader();
    await flushAsyncWork();

    expect(mocks.setState).toHaveBeenCalledWith({
      label: "new",
      href: "https://github.com/SubBoost/subboost/releases/latest",
      external: true,
      title: "SubBoost 有新版本",
      ariaLabel: "SubBoost 有新版本",
    });
  });

  it("keeps the extra badge hidden when no update is available or the payload is incomplete", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ hasUpdate: false })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ hasUpdate: true, releaseUrl: "   " })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ hasUpdate: true, releaseUrl: 123 })))
    );

    renderHeader();
    await flushAsyncWork();
    renderHeader();
    await flushAsyncWork();
    renderHeader();
    await flushAsyncWork();

    expect(mocks.setState).toHaveBeenCalledTimes(3);
    expect(mocks.setState).toHaveBeenNthCalledWith(1, null);
    expect(mocks.setState).toHaveBeenNthCalledWith(2, null);
    expect(mocks.setState).toHaveBeenNthCalledWith(3, null);
  });

  it("fails quietly when the release check is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 503 }))
        .mockRejectedValueOnce(new Error("network down"))
        .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
    );

    renderHeader();
    await flushAsyncWork();
    renderHeader();
    await flushAsyncWork();
    renderHeader();
    await flushAsyncWork();

    expect(mocks.setState).toHaveBeenCalledTimes(1);
    expect(mocks.setState).toHaveBeenCalledWith(null);
  });

  it("aborts the release check on cleanup", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");

    renderHeader();
    mocks.cleanup?.();

    expect(abortSpy).toHaveBeenCalled();
  });

  it("does not set state after cleanup when the response resolves later", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      )
    );

    renderHeader();
    mocks.cleanup?.();
    resolveFetch(
      new Response(
        JSON.stringify({
          hasUpdate: true,
          latestTag: "v9.8.7",
          releaseUrl: "https://github.com/SubBoost/subboost/releases/tag/v9.8.7",
        })
      )
    );
    await flushAsyncWork();

    expect(mocks.setState).not.toHaveBeenCalled();
  });

  it("does not set state after cleanup when a non-abort error resolves later", async () => {
    let rejectFetch!: (error: Error) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectFetch = reject;
          })
      )
    );

    renderHeader();
    mocks.cleanup?.();
    rejectFetch(new Error("network down"));
    await flushAsyncWork();

    expect(mocks.setState).not.toHaveBeenCalled();
  });
});
