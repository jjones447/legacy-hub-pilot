// TEST ONLY: exercise legacy provider-envelope/domain tests through a pure
// server mapper injection. Actual HTTP provider admission is tested separately
// in free-only-ai.test.mjs and is OFF. No deployed configuration imports this.
import {postAgentFixture as onRequestPost} from '../helpers/confirmed-agent.mjs';
import {mapRequestToChange,mapRequestToWorkflowChange} from '../../functions/api/agent/_mapper.mjs';
export function postWithInertProvider(context) {
  const {env,request}=context;
  if (typeof env.AGENT_MAPPER_BACKEND === 'function' || (!env.AI && !env.EMP_LLM_GATEWAY_URL)) return onRequestPost(context);
  const mapper = new URL(request.url).pathname.includes('/change/') ? mapRequestToWorkflowChange : mapRequestToChange;
  const backend = args => mapper({...args, ai:env.AI, model:env.AGENT_MODEL,
    backend:env.AGENT_MAPPER_BACKEND, gatewayUrl:env.EMP_LLM_GATEWAY_URL, gatewayKey:env.EMP_LLM_GATEWAY_KEY});
  return onRequestPost({...context,env:{...env,AGENT_MAPPER_BACKEND:backend}});
}
