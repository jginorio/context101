"""
Prompts for the Context101 wiki generator.

Adapted from AsyncFuncAI/deepwiki-open (src/app/[owner]/[repo]/page.tsx),
with these changes:
  - Input is a markdown corpus from S3, not a code repo.
  - No file tree / README — we feed a corpus summary.
  - Single flat page list (deepwiki's "concise" variant). Small team scale.
  - Source citations cite filenames, not line ranges.
  - Mermaid section trimmed — most of deepwiki's rules work around a
    specific React renderer.
  - Language switching dropped (English only).
"""


STRUCTURE_PROMPT = """\
Analyze this team knowledge base and create a wiki structure for it.

The knowledge base is a collection of markdown documents maintained by a small team. Below is each document with its S3 key and a preview of its content.

<corpus>
{corpus_summary}
</corpus>

I want to create a wiki that organizes and synthesizes this knowledge into a coherent, cross-referenced structure. Determine the most logical structure based on the content of the documents.

When designing the wiki structure, include pages that would benefit from visual diagrams, such as:
- Architecture overviews
- Data flow descriptions
- Relationships between systems, teams, or domains
- Process workflows
- State machines

Return your analysis in the following XML format:

<wiki_structure>
  <title>[Overall title for the wiki]</title>
  <description>[Brief description of the knowledge base]</description>
  <pages>
    <page id="page-1">
      <title>[Page title]</title>
      <description>[Brief description of what this page will cover]</description>
      <importance>high|medium|low</importance>
      <relevant_files>
        <file_path>[S3 key of a source markdown file from the corpus above]</file_path>
      </relevant_files>
      <related_pages>
        <related>page-2</related>
      </related_pages>
    </page>
  </pages>
</wiki_structure>

IMPORTANT FORMATTING INSTRUCTIONS:
- Return ONLY the valid XML structure specified above
- DO NOT wrap the XML in markdown code blocks (no ``` or ```xml)
- DO NOT include any explanation text before or after the XML
- Ensure the XML is properly formatted and valid
- Start directly with <wiki_structure> and end with </wiki_structure>

IMPORTANT:
1. Create {min_pages}-{max_pages} pages for a concise wiki of this knowledge base.
2. Each page should focus on a specific topic, domain, or system.
3. Every <file_path> MUST be an actual S3 key from the <corpus> above — do not invent file paths.
4. A page should have at least 1 relevant file; 2-4 is ideal when the corpus supports it.
5. <related_pages> should cross-reference other page IDs from this same structure.
6. Return ONLY valid XML with the structure specified above, with no markdown code block delimiters.
"""


CODE_STRUCTURE_PROMPT = """\
Analyze this codebase and create a wiki structure for it.

This is a single repository: {repo_full_name}. Below is each source file
with its S3 key and a preview of its content (code wrapped in fenced
markdown blocks; .md files passed through as-is).

<corpus>
{corpus_summary}
</corpus>

I want a wiki that explains this codebase clearly enough that a new
engineer could orient themselves and contribute. Plan pages around what's
actually in the repo, not generic categories.

When designing the structure, prioritize pages that benefit from visual
diagrams:
- Architecture / system overview (component diagram)
- Request or data lifecycle (sequence or flowchart)
- Data model + relationships (ER or class diagram)
- Module dependency graph
- Build / deploy / operate (infra, CI, env vars, runtime topology)

Other useful page types when the repo supports them:
- Key modules / packages and their responsibilities
- External integrations (APIs, databases, third-party services)
- Configuration + environment (env vars, feature flags, secrets)
- Testing conventions (how things are tested, what's mocked)
- Conventions worth documenting (anything non-obvious about the project's
  style or assumptions)

Return your analysis in the following XML format:

<wiki_structure>
  <title>[Overall title for this code wiki]</title>
  <description>[Brief description of what the repo does]</description>
  <pages>
    <page id="page-1">
      <title>[Page title]</title>
      <description>[Brief description of what this page will cover]</description>
      <importance>high|medium|low</importance>
      <relevant_files>
        <file_path>[S3 key of a source file from the corpus above]</file_path>
      </relevant_files>
      <related_pages>
        <related>page-2</related>
      </related_pages>
    </page>
  </pages>
</wiki_structure>

IMPORTANT FORMATTING INSTRUCTIONS:
- Return ONLY the valid XML structure specified above
- DO NOT wrap the XML in markdown code blocks (no ``` or ```xml)
- DO NOT include any explanation text before or after the XML
- Ensure the XML is properly formatted and valid
- Start directly with <wiki_structure> and end with </wiki_structure>

IMPORTANT:
1. Create {min_pages}-{max_pages} pages.
2. Every <file_path> MUST be an actual S3 key from the <corpus> above — do not invent file paths.
3. A page should have at least 1 relevant file; 3-6 is ideal for code pages where the topic spans several modules.
4. <related_pages> should cross-reference other page IDs from this same structure.
5. Don't invent pages for things the repo doesn't actually do. If the repo is small, fewer focused pages beat padded ones.
6. Return ONLY valid XML with the structure specified above, with no markdown code block delimiters.
"""


CODE_PAGE_PROMPT = """\
You are an expert technical writer documenting a codebase.
Your task is to generate a comprehensive wiki page in Markdown format about a specific aspect of {repo_full_name}.

You will be given:
1. The [WIKI_PAGE_TOPIC] for the page.
2. [RELEVANT_SOURCE_CONTENT] — the full contents of source files from the repo that you MUST use as the sole basis for the page.

Source files include both markdown docs and source code. Code files are wrapped in fenced markdown blocks; the actual file path is in the wrapper's S3 key.

The first thing on the page MUST be an H1 heading: `# {page_title}`. No preamble, no acknowledgements — start directly with the heading.

Based ONLY on the content of [RELEVANT_SOURCE_CONTENT]:

1.  **Introduction:** 1-2 paragraphs explaining what "{page_title}" is in this codebase and why it matters. If another page in this code wiki would add context, link to it: `[Link Text](other-page-slug.md)`.

2.  **Detailed Sections:** Break the topic into H2 (`##`) and H3 (`###`) sections. For code, this usually means: walking through what a module does, how its functions interact, what types it uses, how it's configured.

3.  **Mermaid Diagrams:** For architecture, data flow, dependencies, or state machines, add Mermaid diagrams (`flowchart TD`, `sequenceDiagram`, `classDiagram`, `erDiagram`). Use top-down (`graph TD`), 3-4 word node labels. Only diagram what the source actually contains — don't invent structure.

4.  **Code Snippets:** Include short, illustrative code blocks straight from the source files when they show a key concept. Fence with the correct language identifier. Don't paste hundreds of lines — pick the exemplary bits and discuss them.

5.  **Tables:** Use tables to summarize config options, function signatures, types, or comparisons.

6.  **Source Citations (IMPORTANT):** After every significant claim, section, diagram, or code excerpt, cite the source file(s). Use this exact format: `Sources: [path/to/file.ext.md]()` for one file or `Sources: [a.md](), [b.md]()` for multiple. Cite by the S3 key (which ends in `.md` because we wrap code files in markdown). You MUST cite every provided source file at least once somewhere on the page.

7.  **Technical Accuracy:** All information must derive SOLELY from [RELEVANT_SOURCE_CONTENT]. Do NOT invent function names, types, env vars, file paths, or behaviors that aren't visible in the source. If the sources disagree, note it — don't silently pick one.

8.  **Voice:** Concise, technical, professional. Don't editorialize.

9.  **Conclusion (optional):** Brief summary if appropriate for "{page_title}".

Remember:
- Ground every claim in the provided source content.
- Prefer accuracy over comprehensiveness — leave out what you can't substantiate.
- Structure the page logically for a developer reading it to learn this part of the codebase.

[WIKI_PAGE_TOPIC]
Title: {page_title}
Description: {page_description}

[RELEVANT_SOURCE_CONTENT]
{source_content}
"""


PAGE_PROMPT = """\
You are an expert technical writer.
Your task is to generate a comprehensive and accurate wiki page in Markdown format about a specific topic within a team's shared knowledge base.

You will be given:
1. The [WIKI_PAGE_TOPIC] for the page.
2. [RELEVANT_SOURCE_CONTENT] — the full contents of markdown files from the knowledge base that you MUST use as the sole basis for the page.

The first thing on the page MUST be an H1 heading: `# {page_title}`. No preamble, no acknowledgements — start directly with the heading.

Based ONLY on the content of [RELEVANT_SOURCE_CONTENT]:

1.  **Introduction:** Start with a concise introduction (1-2 paragraphs) explaining the purpose and scope of "{page_title}" within the context of the knowledge base. Where another page in this wiki would add context, link to it using `[Link Text](other-page-slug.md)`.

2.  **Detailed Sections:** Break "{page_title}" into logical sections using H2 (`##`) and H3 (`###`) Markdown headings. For each section, explain the architecture, process, concepts, or information from the source files.

3.  **Mermaid Diagrams:** Where it adds clarity, use Mermaid diagrams (`flowchart TD`, `sequenceDiagram`, `classDiagram`, `erDiagram`) to visualize architectures, flows, relationships, or schemas described in the source files. Use top-down orientation (`graph TD`), not LR. Keep node labels to 3-4 words. Only add a diagram when the source material actually describes relationships or flows worth visualizing — don't invent structure.

4.  **Tables:** Use Markdown tables to summarize structured information (config options, data fields, comparison tables) where the source supports it.

5.  **Code Snippets (optional):** Include short, relevant code snippets directly from the source files when they illustrate a key concept. Use fenced blocks with the correct language identifier.

6.  **Source Citations (IMPORTANT):** After every significant claim, section, diagram, or table, cite the source file(s) the information came from. Use this exact format: `Sources: [filename.md]()` for a single source, or `Sources: [a.md](), [b.md]()` for multiple. Cite by the S3 key, not a display name. You MUST cite every provided source file at least once somewhere on the page.

7.  **Technical Accuracy:** All information must be derived SOLELY from [RELEVANT_SOURCE_CONTENT]. Do NOT invent facts, names, IDs, URLs, numbers, schema details, or technical terms. If the sources disagree, note the disagreement — don't silently pick one. If information isn't present, don't include it.

8.  **Clarity and Voice:** Use clear, professional, concise technical language. Preserve the authors' voice when synthesizing — don't formalize or casualize.

9.  **Conclusion (optional):** End with a brief summary paragraph if appropriate for "{page_title}".

Remember:
- Ground every claim in the provided source content.
- Prioritize accuracy and direct representation of the sources.
- Structure the page logically for developers reading it to learn.

[WIKI_PAGE_TOPIC]
Title: {page_title}
Description: {page_description}

[RELEVANT_SOURCE_CONTENT]
{source_content}
"""


# Appended to the base page prompt for candidate drafts after the first
# (deterministic) one. Kept to a single directive so the candidates explore
# different organizations of the *same* sourced facts — never different facts.
VARIANT_DIRECTIVE = """\
[VARIANT INSTRUCTION]
Produce an alternative version of this page that reorganizes and reframes the
same sourced material differently (different section ordering, emphasis, or
diagram choices) while staying strictly grounded in the provided sources. Do
not introduce any facts, names, or claims not present in the source content.
"""


# ── Judge / merge (Level 1: within-page conflict resolution) ──────────
# The judge receives N candidate drafts of one page plus a freshness table
# (each source's last-edited timestamp) and returns ONE merged page. When the
# page's own sources disagree, it must prefer the NEWER source by recency and
# flag the conflict. Output contract (parsed by generate.py): the merged page
# markdown starting with `# <title>`, then OPTIONALLY a trailing
# <drift_findings> XML block (omitted entirely when there are no conflicts).
# _DRIFT_FINDINGS_SPEC is concatenated in (not a format placeholder) because it
# contains literal XML; the page prompts only .format() the named fields.
_DRIFT_FINDINGS_SPEC = """\
After the page, if (and only if) the sources conflicted, append a single XML
block documenting each conflict. Use EXACTLY this schema and nothing else:

<drift_findings>
  <finding>
    <conflicting_keys>
      <key>[S3 key of a source involved in the conflict]</key>
      <key>[another source key]</key>
    </conflicting_keys>
    <description>[what the sources disagree about, in one or two sentences]</description>
    <suggested_action>[what a human should do to resolve it at the source]</suggested_action>
  </finding>
</drift_findings>

Rules for conflicts:
- Use the <sources> freshness table: when two sources disagree on a fact, write
  the page using the source with the NEWER `modified` timestamp, and record a
  finding noting which sources disagreed.
- If the conflicting sources have equal or unknown timestamps, do NOT silently
  pick one — present the discrepancy neutrally in the page AND record a finding.
- Only list source keys that actually appear in the freshness table.
- If there are no conflicts, output NOTHING after the page (no empty block).
"""


JUDGE_PROMPT = """\
You are the editor merging several independently-written drafts of one wiki
page into a single best version. All drafts cover the same topic from the same
source files.

Page title: {page_title}

Here are the source freshness timestamps (used to break conflicts — newer wins):
{freshness_table}

Here are the candidate drafts:
{candidates}

Produce ONE final page in Markdown that takes the strongest, most accurate and
best-organized material from across the drafts. The first line MUST be the H1
heading `# {page_title}` — no preamble. Preserve the source-citation format
(`Sources: [key.md]()`) and ensure every source cited by any draft is still
cited. Do not introduce facts that none of the drafts grounded in the sources.

""" + _DRIFT_FINDINGS_SPEC


CODE_JUDGE_PROMPT = """\
You are the editor merging several independently-written drafts of one code
wiki page into a single best version. All drafts document the same aspect of
the codebase from the same source files.

Page title: {page_title}

Source freshness timestamps (used to break conflicts — newer wins):
{freshness_table}

Candidate drafts:
{candidates}

Produce ONE final page in Markdown taking the most technically accurate and
clearly-organized material from across the drafts. The first line MUST be the
H1 heading `# {page_title}` — no preamble. Preserve code snippets, Mermaid
diagrams, and the source-citation format (`Sources: [key.md]()`); every source
cited by any draft must remain cited. Do not invent function names, types, env
vars, or behaviors that no draft grounded in the sources.

""" + _DRIFT_FINDINGS_SPEC


# ── Cross-page consistency (Level 3: page-vs-page reconciliation) ─────
# Two already-generated pages that share source files are checked for
# contradictions. If they disagree on a shared fact, reconcile both toward the
# NEWER shared source. Output contract (parsed by generate.py): a
# <reconciled id="<page-id>"> block per page actually changed (full corrected
# markdown), plus an OPTIONAL trailing <drift_findings> block for
# contradictions recency can't resolve. Nothing at all when already consistent.
CROSS_PAGE_PROMPT = """\
You are checking two related wiki pages for contradictions. They share one or
more source files, so they must not disagree about the same facts.

Page A — id="{page_a_id}", title="{page_a_title}"
Page B — id="{page_b_id}", title="{page_b_title}"

Shared source freshness timestamps (newer wins when they conflict):
{freshness_table}

--- PAGE A ---
{page_a_body}

--- PAGE B ---
{page_b_body}

Compare the two pages. If they contradict each other on a shared fact, correct
the page(s) so both agree, grounding the corrected statement in the source with
the NEWER `modified` timestamp. Preserve each page's structure, H1 heading, and
`Sources: [key.md]()` citations — only change what is needed to remove the
contradiction. Do not introduce new facts.

Output ONLY the following, and nothing else:
- For each page you changed, a block (omit it for a page you did not change):
  <reconciled id="PAGE-ID">
  ...full corrected page markdown starting with its H1...
  </reconciled>
- If a contradiction cannot be resolved by recency (equal or unknown
  timestamps), append a <drift_findings> block using EXACTLY this schema:
  <drift_findings>
    <finding>
      <conflicting_keys><key>shared-source-key.md</key></conflicting_keys>
      <description>[what the two pages disagree about]</description>
      <suggested_action>[how a human should resolve it]</suggested_action>
    </finding>
  </drift_findings>
- If the pages are already consistent, output nothing at all.
"""
