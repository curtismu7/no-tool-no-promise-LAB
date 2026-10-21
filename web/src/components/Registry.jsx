import React from "react";

export default function Registry({ registry }) {
  if (!registry) return null;
  const [a, b] = registry.agents;
  const cell = (agent, tool) => {
    const has = agent.tools.some((t) => t.name === tool.name);
    return has
      ? <td className={`yes ${tool.commits ? "commit" : ""}`}><span className="tag ok">in set</span>{tool.requiresApproval && <span className="small"> needs approval</span>}</td>
      : <td className="absent" data-absent="true"><span className="tag mute">absent</span><span className="small"> denied</span></td>;
  };
  return (
    <div className="scroll-x">
      <table className="registry" data-testid="registry">
        <caption>Tool registry. Deny by default: an agent may call only the tools in its own set. Everything else is refused and audited.</caption>
        <thead>
          <tr>
            <th scope="col">Tool</th><th scope="col">What it does</th>
            {registry.agents.map((ag) => <th scope="col" key={ag.id}>{ag.profile === "governed" ? "Governed agent" : "Ungoverned agent"}</th>)}
          </tr>
        </thead>
        <tbody>
          {registry.tools.map((t) => (
            <tr key={t.name} className={t.commits ? "commit-row" : ""}>
              <th scope="row"><code>{t.name}</code>{t.commits && <span className="tag deny"> commits</span>}</th>
              <td className="small">{t.description}</td>
              {cell(a, t)}{cell(b, t)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
