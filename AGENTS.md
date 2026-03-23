<!-- BEGIN:nextjs-agent-rules 
 
# Next.js: ALWAYS read docs before coding
 
Before any Next.js work, find and read the relevant docs in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

If the docs do not exist in the specified directory, refer to the docs at https://github.com/vercel/next.js/tree/v16.1.6/docs - ensuring the v parameter of the URL matches the current version of next installed in the project.
 
 END:nextjs-agent-rules -->


<!-- BEGIN:prisma-agent-rules -->
 
# Prisma: ONLY use snake case for database table, field, and function names
Camel Case should only be used in the application.

<!-- END:prisma-agent-rules -->

<!-- BEGIN:documentation-agent-rules -->
 
# Keep all documentation up to date
docs found in the docs/ directory of the app should be kept up to date. Either update or remove outdated documentation.

# Bug fixes should be tracked
When a issue is reported, upon completion of fix implementation, the issue and fix should be documented in docs/bug-fixes.md. If the error persists, the fix should be marked failed and the follow up resolution should be logged. This will enable tracking fixes across chats so fixes aren't reverted.

# bug-fixes.md should be considered before making changes
Ensure the solution you are considering will not create conflict with a previous bug fix or re-introduce that bug. Also ensure the solution is not related to a already documented issue and the fix has not been tried and failed.

<!-- END:documentation-agent-rules -->

<!-- BEGIN:Response-agent-rules -->
# Simple change summary responses
Avoid long detailed responses after bug fixes, provide no more than a short 1-2 sentence summary.
<!-- END:Response-agent-rules -->