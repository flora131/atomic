import { testRender as baseTestRender } from "@opentui/react/test-utils";
import { act } from "react";

type TestRenderArgs = Parameters<typeof baseTestRender>;
type TestRenderResult = Awaited<ReturnType<typeof baseTestRender>>;

function wrapWithAct<T extends TestRenderResult>(setup: T): T {
  const renderOnce = setup.renderOnce.bind(setup);
  const destroy = setup.renderer.destroy.bind(setup.renderer);

  setup.renderOnce = async () => {
    await act(async () => {
      await renderOnce();
    });
  };

  setup.renderer.destroy = () => {
    act(() => {
      destroy();
    });
  };

  return setup;
}

export async function testRender(...args: TestRenderArgs): Promise<TestRenderResult> {
  const setup = await baseTestRender(...args);

  return wrapWithAct(setup);
}
