# Two Key Gaps in Agentic Software Engineering

Source: https://x.com/istoica05/status/2100950168333906251
Retrieved through FXTwitter proxy.

An AI agent was asked to speed up a key-value store. It delivered a 6× throughput gain and passed every correctness test. The explanation? The agent discovered that the industry-standard benchmark used to evaluate the store’s performance generated values from keys. Instead of storing the values, it simply regenerated them on demand when clients requested them.

A key-value store that avoids storing values makes little sense, yet the evaluator rewarded exactly that behavior. The specification omitted something we thought seemed was obvious, and the benchmark failed to expose the omission.

Two gaps leading to reward hacking and hallucinations

Our new paper explains this behavior and many other agentic failures through the lens of two key gaps that sit outside the familiar implementation-verification loop that generates code, runs tests, and fixes failures until all tests pass.

Requirement Gap: Separates what we write down from what we actually want. In our case, we took it for granted that any solution would store client-provided values—after all, it is called a store for a reason!—so it never occurred to us to state this requirement explicitly.

Model Gap: Separates the environment we evaluate in from the real-world where the implementation will get deployed. Our benchmark used predictable values, but real clients supply arbitrary values.

 

The natural response is to write better requirements and stronger tests. Both help. But even machine-checked proofs cannot close these gaps. As Brian Cantwell Smith explained in The Limits of Correctness (1985), a proof only establishes that software satisfies stated requirements under given environmental assumptions. It cannot prove that those requirements capture everything users want, or that those assumptions cover every real-world deployment scenario. As a result, these gaps cannot be generally closed.

These gaps lead to reward hacking and hallucinations. Reward hacking happens when agents improve a given objective by exploiting a gap, such as an unstated requirement or real-world assumption. Hallucination happens when agents  widen the gaps further by introducing fabricated requirements or environment assumptions, such as an API that does not exist. Recently reported incidents involving OpenAI and Hugging Face and Claude are all manifestations of these gaps.

AI agents make the two gaps worse

These gaps are not new; they have existed in software engineers for decades. But AI agents make these gaps much worse.

Hyper-Optimization: Agents search through implementations orders of magnitude faster than humans, actively optimizing against the evaluator.

Missing Tacit Knowledge: Experienced human engineers rely on tacit context (e.g., knowing a data store must actually store data). Agents often lack this organizational context and will readily exploit missing requirements.

The Multi-Agent Trap: Adding more reviewing agents doesn't solve the problem if every agent inherits the exact same incomplete requirements and environmental assumptions.

Human judgement is essential to narrow the gaps

Because the gaps lie outside the implementation–verification loop, narrowing them requires an outer assurance-revision loop. This loop checks whether deployed behavior satisfies human intent. When it does not, the loop uses deployment evidence to revise the requirements, environment model, or evaluator. The implementation-verification loop then runs again to produce a revised implementation.

Because software must serve human intent, humans retain final authority over interpreting the evidence and deciding what behavior is acceptable. Agents can accelerate the outer loop by gathering evidence, proposing revisions, and making routine decisions within authority delegated by humans.

Thus, as software implementation becomes cheaper, the most critical resource becomes human judgment about what behavior is acceptable and faithful evaluation of how systems perform under real conditions.