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
