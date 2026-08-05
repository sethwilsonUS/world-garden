import { navigateBackOrReplace } from "./back-navigation";

const createRouter = (canGoBack: boolean) => ({
  back: jest.fn(),
  canGoBack: jest.fn(() => canGoBack),
  replace: jest.fn(),
});

describe("navigateBackOrReplace", () => {
  it("returns through existing in-app history", () => {
    const router = createRouter(true);

    navigateBackOrReplace(router, "/search");

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("sends a cold article deep link to the promised search screen", () => {
    const router = createRouter(false);

    navigateBackOrReplace(router, "/search");

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/search");
  });
});
