import type { AgentState } from "../../../models/agent";
import { clearToolRouteCache } from "./tool-filter";

export const rewindState = (checkpoints: Array<{ state: AgentState, options: string[] }>, state: AgentState) => {
  clearToolRouteCache();
  let newState = { ...state };
  let newCheckpoints = [...checkpoints];
  while (newCheckpoints.length > 0) {
    let lastCheckpoint = newCheckpoints.at(-1);
    if (lastCheckpoint!.options.length > 0) {
      lastCheckpoint!.options.shift();
      if (lastCheckpoint!.options.length > 0) {
        newState = {
          ...lastCheckpoint!.state,
          selectedTool: lastCheckpoint!.options[0],
          state: 'EXECUTE',
        };
        return { state: newState, checkpoints: newCheckpoints };
      }
    }
    newCheckpoints.pop();
  }
  return { state: newState, checkpoints: newCheckpoints }
}
