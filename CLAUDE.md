## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Rules:
-For all code you write, above chunks of code add explanatory comments. 
- When implementing a feature, test it in the browser (localhost:{the port it is running at}), if it doesnt work (gives error or undesired output) then state that and keep fixing it.
- When going through the codebase, dont read the folder /node_modules. It just contains node modules.  
- Don't break existing working code unless the changes are necessary for building a new feature or fixing a bug.
- While implementing features, dont assume what I want, ask for details. 
- When an excel is uploaded, ask for data mappings, what field is mapped to what variable and that variable is stored in what place. Clarify these things instead of assuming. 
- If you encounter one problem that you are stuck in, dont go down a rabit hole and make a lot of changes. Instead, pause and look for an alternate solution. 
- Always follow best practices. If I suggest somethings thats not the best practice, ask for confirmation while stating the reason. 


