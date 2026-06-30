import React, { useState, useRef, useEffect } from 'react';
import { Copy, Download, Plus, ArrowRight, ArrowUp, AlertCircle, Loader, Brain, Check, Bookmark, RefreshCw, Lock, Clock, Search, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './PMClaudeWorkspace.css';

const PRD_STORAGE_KEY = 'pm-claude-prd';

// Extract plain text from React children (for slugifying heading text)
const childrenToText = (children) => {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (child && child.props && child.props.children) return childrenToText(child.props.children);
      return '';
    })
    .join('');
};

// GitHub-flavored slug: lowercase, strip punctuation, spaces -> hyphens.
// Matches the anchor targets the model emits for TOC links like [Foo Bar](#foo-bar).
const slugify = (text) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');

// The library holds every PRD the user has generated (newest first); this is
// the substrate for "memory" — past PRDs feed context into new generations.
const PRD_LIBRARY_KEY = 'pm-claude-prd-library';

const makeId = () => `prd_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

// Older saved PRDs predate ids; backfill so they can live in the library.
const ensureId = (prd) =>
  prd && prd.id ? prd : { ...prd, id: makeId(), createdAt: prd?.createdAt || Date.now() };

const loadStoredLibrary = () => {
  try {
    const saved = localStorage.getItem(PRD_LIBRARY_KEY);
    if (saved) return JSON.parse(saved).map(ensureId);
    // One-time migration from the old single-PRD key.
    const single = localStorage.getItem(PRD_STORAGE_KEY);
    if (single) {
      const prd = JSON.parse(single);
      return prd ? [ensureId(prd)] : [];
    }
    return [];
  } catch {
    return [];
  }
};

// A short, recognizable label for chips — the user's own problem statement.
const derivePRDTitle = (brief) => {
  const src = (brief?.problem || brief?.idea || '').trim();
  if (!src) return 'Untitled PRD';
  const firstLine = src.split('\n')[0].trim();
  return firstLine.length > 56 ? `${firstLine.slice(0, 56).trim()}…` : firstLine;
};

// Naive relevance: shared significant keywords between the new brief and a past
// PRD. Good enough to surface the right chips; embeddings come in Phase 2.
const STOPWORDS = new Set(
  'this that with from have will your you our user users need needs problem solution feature features when what which while them they their about into more most some when then than also have been being does doing make makes want wants like just only over under such these those'.split(' ')
);
const tokenize = (text) => (text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
const keywordSet = (text) =>
  new Set(tokenize(text).filter((w) => w.length > 3 && !STOPWORDS.has(w)));
const relevanceScore = (queryKW, prd) => {
  const prdKW = keywordSet(`${prd.title || ''} ${prd.originalBrief?.problem || ''} ${prd.originalBrief?.idea || ''}`);
  let score = 0;
  queryKW.forEach((w) => {
    if (prdKW.has(w)) score += 1;
  });
  return score;
};

// Condensed past-PRD context injected into the generation prompt. This is where
// the memory value actually lives — the model sees prior decisions and metrics.
const buildMemoryBlock = (prds) => {
  if (!prds || prds.length === 0) return '';
  const blocks = prds
    .map((prd, i) => {
      const excerpt = (prd.content || '').slice(0, 1200);
      const label = prd.type === 'comprehensive' ? 'Full PRD' : 'One-pager';
      return `### Past PRD ${i + 1}: ${prd.title} (${label}, ${prd.timestamp})\n${excerpt}`;
    })
    .join('\n\n');
  return `\n\n--- MEMORY: the user's past PRDs ---\nUse these for consistency in terminology, success metrics, and prior decisions. If this new PRD contradicts a past decision or success metric, call it out explicitly in the Open Questions section and name the conflicting PRD.\n\n${blocks}\n--- END MEMORY ---\n`;
};

// The "What I remember" profile: a distilled, user-editable summary of the PM's
// product world, synthesized from the library and injected into every generation.
const PROFILE_KEY = 'pm-claude-profile';
const PROFILE_FIELDS = [
  { key: 'productArea', label: 'Product area' },
  { key: 'recurringGoals', label: 'Recurring goals' },
  { key: 'houseStyle', label: 'House style' },
  { key: 'pastDecisions', label: 'Past decisions' },
];

const loadStoredProfile = () => {
  try {
    const saved = localStorage.getItem(PROFILE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

// Pull a JSON object out of the model's reply (tolerates code fences / stray prose).
const parseProfileJSON = (text) => {
  try {
    const cleaned = (text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    return {
      productArea: obj.productArea || '',
      recurringGoals: obj.recurringGoals || '',
      houseStyle: obj.houseStyle || '',
      pastDecisions: obj.pastDecisions || '',
    };
  } catch {
    return null;
  }
};

const buildProfileBlock = (profile) => {
  if (!profile) return '';
  const lines = PROFILE_FIELDS.filter((f) => profile[f.key]).map((f) => `${f.label}: ${profile[f.key]}`);
  if (lines.length === 0) return '';
  return `\n\n--- WHAT I KNOW ABOUT THIS PM'S PRODUCT (curated profile) ---\nMatch this context, terminology, and style unless the brief says otherwise.\n${lines.join('\n')}\n--- END PROFILE ---\n`;
};

// ============================================================================
// THE BRAINS: the system prompt that turns a brief into a senior-PM PRD.
// This is the product. It does not ask for "a document with these sections" —
// it encodes how a senior PM *thinks*: evidence discipline, explicit
// assumptions, decision-forcing, and honesty about what is unknown. Edit with
// care; this is the single highest-leverage string in the codebase.
// ============================================================================

// Shared standard applied to every generation, regardless of PRD type.
const SYSTEM_BASE = `You are Otto, a principled senior product manager. You write PRDs the way the best PMs do: the reasoning is visible, the claims are honest, and the document forces a decision rather than just describing one. PMs trust you because your work survives scrutiny from engineering, design, and executives — nothing in it falls apart when someone pushes.

HOW YOU THINK
- Interrogate the problem before reaching for a solution. Who exactly has it, how often, and what does it cost them and the business today? If the brief is vague, sharpen it explicitly and state what you assumed rather than writing around the gap.
- Lead with the core bet. State the central hypothesis the solution rests on in one sentence, then name at least one alternative you considered and why you set it aside.
- Make tradeoffs explicit. Every scope, sequencing, or design choice gives something up — say what, not only what you chose.
- Be decision-forcing. Where the brief leaves a fork unresolved, lay out the options and make a clear recommendation with a rationale. Do not hide behind "it depends."

EVIDENCE DISCIPLINE — THIS IS NON-NEGOTIABLE
- Use ONLY the facts in the brief and the provided memory/profile. Do NOT invent metrics, user counts, revenue figures, research findings, customer quotes, dates, percentages, or competitor details. Fabricated data is the worst thing you can produce: a PM who repeats an invented number in a review loses credibility. Protect them.
- Classify every load-bearing claim as one of three kinds, and make the kind visible:
  - Evidence — stated in the brief or memory. Use it directly.
  - Assumption — a reasonable inference you are making to move forward. Mark it inline in bold as [Assumption] and collect the important ones in Open Questions for the PM to validate.
  - Unknown — needed but absent. Name it as an open question instead of papering over it.
- If you must put a number to something, label it an estimate and state the basis (for example: "rough estimate, assuming the brief's stated 10k MAU"). Never present an estimate as a measured fact.
- It is always better to write "we do not yet know X" than to fill the gap with something plausible and false.

USING MEMORY
- When a profile or past PRDs are provided, match the PM's terminology, recurring metrics, and prior decisions so this PRD is consistent with their body of work.
- If this brief contradicts a past decision or a previously stated metric or target, do NOT silently override it. Flag the conflict explicitly in Open Questions and name the prior PRD.
- Treat memory as context, not as content to copy. Do not restate old PRDs.

OUTPUT CONTRACT
- Output GitHub-flavored Markdown only. No preamble, no sign-off, no "Here is your PRD" — start directly with the document.
- Begin with a single H1 title naming the initiative (not the literal word "PRD").
- Use H2 (##) for each major section and H3 (###) for sub-points. Section headings must be plain words separated by single spaces — no ampersands, slashes, colons, parentheses, or other punctuation (write "and", not "&"; write "Go to Market", not "Go-to-Market") so in-document anchor links resolve cleanly.
- Use tables for anything comparative or structured (metrics with targets, scope in/out, options considered). Use bold for key terms. Keep paragraphs tight and favor crisp lists over walls of text.
- Write at a senior altitude: high signal, no filler, and never restate a section's name back as a sentence.`;

// Comprehensive PRD: depth, with a clickable Table of Contents.
const SYSTEM_COMPREHENSIVE = `${SYSTEM_BASE}

PRD TYPE: COMPREHENSIVE. Target roughly 1,500 to 2,500 words. Every section must earn its place — depth, not padding.

Immediately after the H1 title, output a section titled "## Table of Contents" containing a bulleted list that links to every section below, using standard lowercase hyphenated anchors. For example:
- [Problem Statement](#problem-statement)
- [Problem Exploration](#problem-exploration)

Then write these sections, in order, as H2 headings with exactly these names:

1. Problem Statement — the problem in two or three sentences: who, what, and the cost of inaction. No solution yet.
2. Problem Exploration — root cause, how you know it is real (cite the brief's evidence by name), how widespread or frequent it is, and what happens if nothing is done.
3. Value Proposition — the value to the user and to the business if this is solved, tied to a concrete goal.
4. Solution Overview — the core bet in one sentence, then how it works. Name one alternative considered and why this one won.
5. Success Metrics — a table with columns Metric, Target, and Guardrail (a counter-metric that would tell you the change did harm). No vanity metrics; tie each to the problem. Mark any target you assumed as [Assumption].
6. Scope — what is in v1, then an explicit Non Goals list of what is deliberately out. Phase the work if that adds clarity.
7. Design and Technical Approach — the key UX flows and the technical considerations or constraints drawn from the brief. Flag clearly where engineering input is required.
8. Timeline — phased milestones. If the brief gives no dates, provide relative sequencing and mark any concrete dates as [Assumption].
9. Go to Market — how this reaches users (launch, comms, enablement), pitched at the scale of the initiative.
10. Dependencies — the teams, systems, or decisions this work relies on.
11. Open Questions — the real, decision-blocking unknowns and the assumptions that need validation, including any conflicts with memory. Be specific and actionable; no filler. This is one of the most valuable sections — invest in it.
12. Appendix — supporting detail and the raw evidence from the brief that would clutter the body.`;

// One-pager: speed and clarity. No TOC — it is short by design.
const SYSTEM_ONEPAGER = `${SYSTEM_BASE}

PRD TYPE: ONE-PAGER. Optimize for speed and clarity — something a PM could drop into Slack and act on today. Target under 700 words and be ruthless about brevity, but hold the same evidence discipline. Do NOT include a Table of Contents.

Write these sections, in order, as H2 headings with exactly these names:

1. Problem — who has it and why it matters, in a few sentences.
2. Value Proposition — the payoff if it is solved.
3. Solution — the core bet and how it works, briefly.
4. Who — the target user or segment.
5. Success Metrics — a small table of two to four metrics with targets. Mark assumed targets as [Assumption].
6. Scope — what is in v1, plus a short Non Goals list.
7. Risks — the top risks, and call out the single riskiest assumption.
8. Open Questions — the few real unknowns blocking a decision, plus any conflicts with memory.`;

const buildSystemPrompt = (prdType) =>
  prdType === 'comprehensive' ? SYSTEM_COMPREHENSIVE : SYSTEM_ONEPAGER;

const PMClaudeWorkspace = () => {
  const initialLibrary = loadStoredLibrary();
  const activePRD = initialLibrary[0] || null;
  const [library, setLibrary] = useState(initialLibrary);
  const [screen, setScreen] = useState(activePRD ? 'viewing' : 'type-select');
  const [prdType, setPrdType] = useState(activePRD?.type || null);
  const [formData, setFormData] = useState({});
  const [contextOverrides, setContextOverrides] = useState({});
  const [profile, setProfile] = useState(loadStoredProfile);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [generatedPRD, setGeneratedPRD] = useState(activePRD);
  const [validationMessage, setValidationMessage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [updateData, setUpdateData] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState('Thinking like a senior PM...');
  const [formFading, setFormFading] = useState(false);
  const [bannerError, setBannerError] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const prdContentRef = useRef(null);

  // Scroll a heading into view within the PRD scroll container (anchor links
  // can't use native #hash navigation because the content scrolls in a div).
  // Robust by design: a TOC link's visible text always matches its heading, so
  // we try slugify(link text) first and fall back to the raw href — that way
  // the jump works even if the model's anchor differs from our heading ids.
  const scrollToHeadingById = (id) => {
    const container = prdContentRef.current;
    if (!container || !id) return false;
    const target = container.querySelector(`#${CSS.escape(id)}`);
    if (!target) return false;
    const top = target.offsetTop - container.offsetTop - 12;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    return true;
  };

  const handleAnchorClick = (e, href, linkText) => {
    if (!href || !href.startsWith('#')) return;
    e.preventDefault();
    const fromText = slugify(linkText || '');
    if (!scrollToHeadingById(fromText)) {
      scrollToHeadingById(href.slice(1));
    }
  };

  const scrollToTop = () => {
    prdContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleContentScroll = (e) => {
    setShowBackToTop(e.target.scrollTop > 300);
  };

  // Keep the active PRD mirrored into the library (insert on first generation,
  // update in place on continue/update/regenerate).
  useEffect(() => {
    if (!generatedPRD?.id) return;
    setLibrary((prev) => {
      const idx = prev.findIndex((p) => p.id === generatedPRD.id);
      if (idx === -1) return [generatedPRD, ...prev];
      if (prev[idx] === generatedPRD) return prev;
      const next = [...prev];
      next[idx] = generatedPRD;
      return next;
    });
  }, [generatedPRD]);

  // Persist the whole library so PRDs (and the memory they provide) survive a refresh.
  useEffect(() => {
    try {
      localStorage.setItem(PRD_LIBRARY_KEY, JSON.stringify(library));
    } catch {
      /* localStorage unavailable (private mode / quota) — fail silently */
    }
  }, [library]);

  // Persist the curated "what I remember" profile.
  useEffect(() => {
    try {
      if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      else localStorage.removeItem(PROFILE_KEY);
    } catch {
      /* localStorage unavailable — fail silently */
    }
  }, [profile]);

  const comprehensiveFields = [
    { key: 'problem', label: 'Problem Brief', placeholder: 'Describe the core problem the user is trying to solve', rows: 3 },
    { key: 'evidence', label: 'Evidence (if you have it)', placeholder: 'Quantitative: What metrics show this is real?\nQualitative: User quotes or research findings', rows: 3 },
    { key: 'targetUser', label: 'Target User', placeholder: 'Who experiences this problem? What\'s their role/context?', rows: 2 },
    { key: 'solutionIdea', label: 'Initial Solution Idea (optional)', placeholder: 'What are you thinking of building? Or leave blank for suggestions.', rows: 2 },
    { key: 'constraints', label: 'Constraints', placeholder: 'Timeline, team size, platform limitations, budget, dependencies', rows: 2 },
    { key: 'competitors', label: 'Competitors', placeholder: 'Who else is solving this? How? What are they missing?', rows: 2 },
    { key: 'strategic', label: 'Strategic Context', placeholder: 'Why does your company care about this? How does it fit your roadmap?', rows: 2 },
  ];

  const shortFields = [
    { key: 'problem', label: 'Problem', placeholder: 'One or two sentences. What\'s the actual pain point?', rows: 2 },
    { key: 'who', label: 'Who', placeholder: 'One user type. Who experiences this problem?', rows: 1 },
    { key: 'evidence', label: 'Evidence', placeholder: 'One number or one user quote. That\'s it.', rows: 1 },
    { key: 'idea', label: 'Idea', placeholder: 'What are you thinking of building?', rows: 2 },
    { key: 'timeline', label: 'Timeline', placeholder: 'When does this need to ship?', rows: 1 },
    { key: 'constraints', label: 'Constraints', placeholder: 'What can\'t change? (Team size, budget, platforms, dependencies)', rows: 2 },
  ];

  const fields = prdType === 'comprehensive' ? comprehensiveFields : shortFields;

  // Memory context: rank past PRDs by relevance to what's being typed, default
  // the related ones (score > 0) to "included", let the user override either way.
  const memoryQueryKW = keywordSet(
    `${formData.problem || ''} ${formData.idea || ''} ${formData.solutionIdea || ''}`
  );
  // With a query, surface up to 8 by relevance; with nothing typed yet, just show
  // a few recent ones as suggestions so the strip isn't a wall of dim chips.
  const hasMemoryQuery = memoryQueryKW.size > 0;
  const relatedPRDs = library
    .map((prd) => ({ prd, score: relevanceScore(memoryQueryKW, prd) }))
    .sort((a, b) => b.score - a.score || (b.prd.createdAt || 0) - (a.prd.createdAt || 0))
    .slice(0, hasMemoryQuery ? 8 : 4);
  const isContextIncluded = (prd, score) =>
    contextOverrides[prd.id] !== undefined ? contextOverrides[prd.id] : score > 0;
  const selectedContextPRDs = relatedPRDs
    .filter(({ prd, score }) => isContextIncluded(prd, score))
    .map(({ prd }) => prd);
  const toggleContext = (prd, included) =>
    setContextOverrides((prev) => ({ ...prev, [prd.id]: !included }));

  const updateProfileField = (key, value) =>
    setProfile((prev) => ({ ...(prev || {}), [key]: value, updatedAt: new Date().toLocaleString() }));

  // Ask Claude to distill the library into the profile fields.
  const synthesizeProfile = async () => {
    setProfileError(null);
    setIsSynthesizing(true);

    // Cover the WHOLE library — the profile summarizes the entire product world,
    // not a recent slice. Scale each excerpt down as the library grows so the
    // total stays within a rough token budget.
    const CHAR_BUDGET = 12000;
    const perPRD = Math.max(300, Math.floor(CHAR_BUDGET / Math.max(1, library.length)));
    const corpus = library
      .map((prd, i) => `PRD ${i + 1} (${prd.title}):\n${(prd.content || '').slice(0, perPRD)}`)
      .join('\n\n');

    const prompt = `You are analyzing a product manager's past PRDs to build a memory profile that gives their future PRDs consistent context. Read the PRDs below and return ONLY a JSON object (no prose, no code fences) with exactly these string keys:
- "productArea": the product domain/area this PM works in
- "recurringGoals": goals or success metrics that recur across their PRDs
- "houseStyle": their PRD style — length, structure, tone, what they emphasize
- "pastDecisions": notable decisions or scope cuts worth remembering
Keep each value to one or two sentences. Use an empty string if genuinely unknown. Base every value ONLY on what the PRDs actually say — do not invent a product area, metric, or decision that is not supported by the text.

PRDs:
${corpus}`;

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 700,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || data.error || `Request failed (${response.status})`);
      }

      const parsed = parseProfileJSON(data.content?.[0]?.text);
      if (!parsed) {
        throw new Error('The profile came back unreadable. Please try again.');
      }

      setProfile({ ...parsed, updatedAt: new Date().toLocaleString(), fromCount: library.length });
    } catch (error) {
      setProfileError(`Couldn't build your profile. ${error.message}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleFormChange = (key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setValidationMessage(null);
  };

  const validateInput = () => {
    if (!formData.problem || formData.problem.trim().length < 20) {
      setValidationMessage('Problem statement is required and should be at least 20 characters');
      return false;
    }
    if (!formData.evidence || formData.evidence.trim().length < 10) {
      setValidationMessage('Please provide at least one piece of evidence (number or quote)');
      return false;
    }
    return true;
  };

  const generatePRD = async () => {
    if (!validateInput()) return;

    setFormFading(true);
    setIsGenerating(true);
    setScreen('generating');

    const messages = [
      { msg: 'Thinking like a senior PM...', delay: 0 },
      { msg: 'Structuring your brief...', delay: 2000 },
      { msg: 'Adding open questions...', delay: 4000 },
    ];

    let messageIndex = 0;
    const messageInterval = setInterval(() => {
      if (messageIndex < messages.length) {
        setGeneratingMessage(messages[messageIndex].msg);
        messageIndex++;
      }
    }, 2000);

    let briefContent;
    if (prdType === 'comprehensive') {
      briefContent = `
PROBLEM BRIEF:
${formData.problem}

EVIDENCE (if you have it):
${formData.evidence}

TARGET USER:
${formData.targetUser || 'Not specified'}

INITIAL SOLUTION IDEA (optional):
${formData.solutionIdea || 'No idea yet, looking for suggestions'}

CONSTRAINTS:
${formData.constraints || 'Not specified'}

COMPETITORS:
${formData.competitors || 'Not analyzed'}

STRATEGIC CONTEXT:
${formData.strategic || 'Not specified'}
`;
    } else {
      briefContent = `
PROBLEM:
${formData.problem}

WHO:
${formData.who}

EVIDENCE:
${formData.evidence}

IDEA:
${formData.idea}

TIMELINE:
${formData.timeline}

CONSTRAINTS:
${formData.constraints}
`;
    }

    const systemPrompt = buildSystemPrompt(prdType);

    const profileBlock = buildProfileBlock(profile);
    const memoryBlock = buildMemoryBlock(selectedContextPRDs);
    const userPrompt = `${profileBlock}${memoryBlock}\n\nHere is the brief. Write the ${prdType === 'comprehensive' ? 'comprehensive PRD' : 'one-pager'} now, following every rule in your instructions.\n\nBRIEF\n${briefContent}`;

    // Comprehensive PRDs target ~2500 words / 12 sections, which needs real
    // headroom; the one-pager is short. max_tokens is a ceiling, not a charge —
    // you only pay for tokens actually generated.
    const maxTokens = prdType === 'comprehensive' ? 8000 : 2000;

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      clearInterval(messageInterval);

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.error || `Request failed (${response.status})`);
      }

      const prdText = data.content?.[0]?.text;
      if (!prdText) {
        throw new Error('The response came back empty. Please try again.');
      }

      setGeneratedPRD({
        id: makeId(),
        content: prdText,
        type: prdType,
        title: derivePRDTitle(formData),
        timestamp: new Date().toLocaleString(),
        createdAt: Date.now(),
        originalBrief: formData,
        stopReason: data.stop_reason,
      });

      setContextOverrides({});
      setScreen('viewing');
      setFormFading(false);
    } catch (error) {
      clearInterval(messageInterval);
      setValidationMessage(`Couldn't generate your PRD. ${error.message}`);
      setScreen('form');
      setFormFading(false);
    } finally {
      setIsGenerating(false);
    }
  };

  const continuePRD = async () => {
    setBannerError(null);
    setIsGenerating(true);
    setGeneratingMessage('Finishing your PRD...');

    const continuePrompt = `You were writing a ${prdType === 'comprehensive' ? 'comprehensive PRD' : 'one-pager'} and it was cut off because it hit a length limit. All the rules in your instructions still apply — including evidence discipline and clean section headings.

Here is everything generated so far:

${generatedPRD.content}

Continue from the exact point the text stops. Do not repeat or restate any content already written, and do not add a preamble. Pick up mid-sentence if needed and finish the remaining sections.`;

    const maxTokens = prdType === 'comprehensive' ? 8000 : 2000;

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          system: buildSystemPrompt(prdType),
          messages: [{ role: 'user', content: continuePrompt }],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.error || `Request failed (${response.status})`);
      }

      const continuation = data.content?.[0]?.text;
      if (!continuation) {
        throw new Error('The continuation came back empty. Please try again.');
      }

      setGeneratedPRD(prev => ({
        ...prev,
        content: `${prev.content}${continuation}`,
        timestamp: new Date().toLocaleString(),
        stopReason: data.stop_reason,
      }));
    } catch (error) {
      setBannerError(`Couldn't finish your PRD. ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const copyToClipboard = () => {
    const text = prdContentRef.current?.innerText || generatedPRD.content;
    navigator.clipboard.writeText(text).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    });
  };

  const startUpdate = () => {
    setScreen('updating');
  };

  const submitUpdate = async () => {
    setIsGenerating(true);
    setGeneratingMessage('Updating your PRD...');

    const profileBlock = buildProfileBlock(profile);
    const updatePrompt = `You are revising a ${prdType === 'comprehensive' ? 'comprehensive PRD' : 'one-pager'} you wrote earlier. Regenerate the FULL document, following every rule in your instructions (structure, evidence discipline, and the Table of Contents if this is a comprehensive PRD).

Integrate the new information below. Preserve everything in the original that still holds; only change what the new information actually affects. Where the new information contradicts or resolves something in the original, update it AND note what changed in Open Questions (for example, an assumption that is now confirmed, or a target that moved). Apply the same evidence discipline to the new information — do not treat a claim as fact unless it is stated.
${profileBlock}
ORIGINAL PRD:
${generatedPRD.content}

NEW INFORMATION FROM THE PM:
${updateData}`;

    const maxTokens = prdType === 'comprehensive' ? 8000 : 2000;

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          system: buildSystemPrompt(prdType),
          messages: [{ role: 'user', content: updatePrompt }],
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || data.error || `Request failed (${response.status})`);
      }

      const updatedPRD = data.content?.[0]?.text;
      if (!updatedPRD) {
        throw new Error('The response came back empty. Please try again.');
      }

      setGeneratedPRD(prev => ({
        ...prev,
        content: updatedPRD,
        timestamp: new Date().toLocaleString(),
        stopReason: data.stop_reason,
      }));

      setUpdateData('');
      setScreen('viewing');
    } catch (error) {
      setValidationMessage(`Couldn't update your PRD. ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadAsMarkdown = () => {
    const element = document.createElement('a');
    const file = new Blob([generatedPRD.content], { type: 'text/markdown' });
    element.href = URL.createObjectURL(file);
    element.download = `PRD_${prdType}_${Date.now()}.md`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const resetFlow = () => {
    // Starts a new PRD flow; the library (past PRDs / memory) is intentionally kept.
    setScreen('type-select');
    setPrdType(null);
    setFormData({});
    setContextOverrides({});
    setGeneratedPRD(null);
    setValidationMessage(null);
    setUpdateData('');
    setFormFading(false);
    setBannerError(null);
  };

  // History drawer: open a past PRD into the viewing screen.
  const openPRD = (prd) => {
    setGeneratedPRD(prd);
    setPrdType(prd.type);
    setBannerError(null);
    setShowBackToTop(false);
    setScreen('viewing');
    setShowHistory(false);
  };

  // Forget a PRD (also the data-ownership escape hatch). If it's the one being
  // viewed, fall back to the next most recent, or the home screen if none remain.
  const deletePRD = (id) => {
    const remaining = library.filter((p) => p.id !== id);
    setLibrary(remaining);
    if (generatedPRD?.id === id) {
      const next = remaining[0] || null;
      setGeneratedPRD(next);
      if (next) {
        setPrdType(next.type);
      } else {
        setScreen('type-select');
      }
    }
  };

  const historyResults = library.filter((prd) => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      (prd.title || '').toLowerCase().includes(q) ||
      (prd.content || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="pm-workspace">
      <header className="pm-header">
        <div className="pm-header-content">
          <h1 className="pm-logo">Otto</h1>
          <p className="pm-tagline">Your chief of staff for product management</p>
        </div>
        <div className="pm-header-actions">
          {library.length > 0 && (
            <button className="pm-reset-btn" onClick={() => setShowHistory(true)}>
              <Clock size={15} />
              History
              <span className="pm-header-count">{library.length}</span>
            </button>
          )}
          {screen !== 'type-select' && (
            <button className="pm-reset-btn" onClick={resetFlow}>
              {screen === 'viewing' ? 'New PRD' : 'Start Over'}
            </button>
          )}
        </div>
      </header>

      <main className="pm-main">
        {screen === 'type-select' && (
          <div className="pm-screen type-select-screen">
            <div className="type-select-content">
              <h2>What do you need?</h2>
              <div className="type-grid">
                <button className="type-card" onClick={() => { setPrdType('comprehensive'); setScreen('form'); }}>
                  <div className="type-card-header">
                    <h3>Full PRD</h3>
                    <ArrowRight size={24} />
                  </div>
                  <p>Detailed alignment document. 12 sections. For complex features.</p>
                  <ul className="type-features">
                    <li>Problem exploration</li>
                    <li>Job stories</li>
                    <li>Technical approach</li>
                    <li>Timeline & milestones</li>
                    <li>Open questions</li>
                  </ul>
                  <span className="type-time">~2500 words</span>
                </button>

                <button className="type-card" onClick={() => { setPrdType('short'); setScreen('form'); }}>
                  <div className="type-card-header">
                    <h3>Quick Alignment</h3>
                    <ArrowRight size={24} />
                  </div>
                  <p>One-pager that forces scope decisions. For quick buy-in.</p>
                  <ul className="type-features">
                    <li>Problem & solution</li>
                    <li>Clear scope (in/out)</li>
                    <li>Success metrics</li>
                    <li>Key risks</li>
                    <li>Open questions</li>
                  </ul>
                  <span className="type-time">~800 words</span>
                </button>
              </div>

              {library.length >= 2 && (
                <div className="memory-profile">
                  <div className="memory-profile-header">
                    <Bookmark size={18} />
                    <span className="memory-profile-title">What I remember about your product</span>
                    <button
                      type="button"
                      className="memory-profile-refresh"
                      onClick={synthesizeProfile}
                      disabled={isSynthesizing}
                    >
                      {isSynthesizing ? <Loader size={14} className="spinner" /> : <RefreshCw size={14} />}
                      {profile ? 'Refresh' : `Build from ${library.length} PRDs`}
                    </button>
                  </div>

                  {profileError && (
                    <div className="pm-validation-message">
                      <AlertCircle size={18} />
                      {profileError}
                    </div>
                  )}

                  {profile ? (
                    <>
                      <div className="memory-profile-fields">
                        {PROFILE_FIELDS.map((f) => (
                          <div key={f.key} className="memory-profile-row">
                            <label className="memory-profile-label">{f.label}</label>
                            <textarea
                              className="memory-profile-value"
                              rows={2}
                              value={profile[f.key] || ''}
                              placeholder="—"
                              onChange={(e) => updateProfileField(f.key, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="memory-profile-foot">
                        <Lock size={13} />
                        Stored only for you, on this device. Edit anything — it feeds every new PRD.
                      </div>
                    </>
                  ) : (
                    <p className="memory-profile-empty">
                      You've got {library.length} PRDs saved. Build a profile so every new PRD matches your product context, goals, and style.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {screen === 'form' && (
          <div className="pm-screen form-screen" style={{ opacity: formFading ? 0.6 : 1, transition: 'opacity 0.3s ease' }}>
            <div className="form-container">
              <h2>Let's build your {prdType === 'comprehensive' ? 'PRD' : 'one-pager'}</h2>
              <p className="form-subtitle">The better your input, the better your PRD. Be specific. If you don't have an answer, say so.</p>

              {validationMessage && (
                <div className="pm-validation-message">
                  <AlertCircle size={18} />
                  {validationMessage}
                </div>
              )}

              <form className="pm-form">
                {fields.map(field => (
                  <React.Fragment key={field.key}>
                    <div className="form-group">
                      <label className="form-label">{field.label}</label>
                      <textarea className="form-input" placeholder={field.placeholder} rows={field.rows} value={formData[field.key] || ''} onChange={(e) => handleFormChange(field.key, e.target.value)} />
                    </div>

                    {field.key === 'problem' && library.length > 0 && (
                      <div className="memory-panel">
                        <div className="memory-panel-header">
                          <span className="memory-panel-title">
                            <Brain size={15} />
                            Otto&apos;s memory
                          </span>
                          <span className="memory-panel-count">{library.length} past PRD{library.length > 1 ? 's' : ''}</span>
                        </div>
                        <p className="memory-panel-sub">
                          {!hasMemoryQuery
                            ? 'As you describe the problem above, related past PRDs light up here. Tap any to fold it into this PRD.'
                            : selectedContextPRDs.length > 0
                              ? `${selectedContextPRDs.length} related PRD${selectedContextPRDs.length > 1 ? 's' : ''} will feed this generation. Tap to add or remove.`
                              : 'No clear match yet — keep typing, or tap any past PRD to include it anyway.'}
                        </p>
                        <div className="memory-chips">
                          {relatedPRDs.map(({ prd, score }) => {
                            const included = isContextIncluded(prd, score);
                            return (
                              <button
                                type="button"
                                key={prd.id}
                                className={`memory-chip ${included ? 'memory-chip-on' : ''}`}
                                onClick={() => toggleContext(prd, included)}
                                title={included ? `Remove "${prd.title}" from context` : `Add "${prd.title}" to context`}
                                aria-pressed={included}
                              >
                                {included ? <Check size={14} /> : <Plus size={14} />}
                                <span className="memory-chip-title">{prd.title}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                ))}

                <button type="button" className="pm-button pm-button-primary" onClick={generatePRD} disabled={isGenerating}>
                  {isGenerating ? (<><Loader size={18} className="spinner" />Generating...</>) : ('Generate PRD')}
                </button>
              </form>
            </div>
          </div>
        )}

        {screen === 'generating' && (
          <div className="pm-screen generating-screen">
            <div className="generating-content">
              <div className="generating-spinner"><div className="spinner-dot"></div></div>
              <h2>{generatingMessage}</h2>
              <p>This usually takes 10-15 seconds.</p>
            </div>
          </div>
        )}

        {screen === 'viewing' && generatedPRD && (
          <div className="pm-screen viewing-screen">
            <div className="prd-container">
              <div className="prd-header">
                <div className="prd-meta">
                  <span className="prd-type">{prdType === 'comprehensive' ? 'Full PRD' : 'Quick Alignment'}</span>
                  <span className="prd-timestamp">{generatedPRD.timestamp}</span>
                </div>
                <div className="prd-actions">
                  <button className="pm-action-btn" onClick={copyToClipboard} title="Copy to clipboard">
                    <Copy size={18} />
                    {copyFeedback ? 'Copied!' : 'Copy'}
                  </button>
                  <button className="pm-action-btn" onClick={downloadAsMarkdown} title="Download as Markdown">
                    <Download size={18} />
                    Download
                  </button>
                  <button className="pm-action-btn pm-update-btn" onClick={startUpdate} title="Update with new information">
                    <Plus size={18} />
                    Update
                  </button>
                </div>
              </div>

              {generatedPRD.stopReason === 'max_tokens' && (
                <div className="prd-truncation-banner">
                  <AlertCircle size={18} />
                  <span className="prd-truncation-text">
                    This PRD may have been cut off before it finished.
                  </span>
                  <button
                    className="prd-continue-btn"
                    onClick={continuePRD}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (<><Loader size={16} className="spinner" />Finishing…</>) : ('Continue generating →')}
                  </button>
                </div>
              )}

              {bannerError && (
                <div className="pm-validation-message">
                  <AlertCircle size={18} />
                  {bannerError}
                </div>
              )}

              <div
                className="prd-content prd-markdown"
                ref={prdContentRef}
                onScroll={handleContentScroll}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => <h1 id={slugify(childrenToText(children))}>{children}</h1>,
                    h2: ({ children }) => <h2 id={slugify(childrenToText(children))}>{children}</h2>,
                    h3: ({ children }) => <h3 id={slugify(childrenToText(children))}>{children}</h3>,
                    h4: ({ children }) => <h4 id={slugify(childrenToText(children))}>{children}</h4>,
                    a: ({ href, children, ...props }) => (
                      <a
                        href={href}
                        onClick={(e) => handleAnchorClick(e, href, childrenToText(children))}
                        {...(href && !href.startsWith('#')
                          ? { target: '_blank', rel: 'noopener noreferrer' }
                          : {})}
                        {...props}
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {generatedPRD.content}
                </ReactMarkdown>
              </div>
              {showBackToTop && (
                <button
                  className="prd-back-to-top"
                  onClick={scrollToTop}
                  title="Back to top"
                  aria-label="Back to top"
                >
                  <ArrowUp size={18} />
                  Top
                </button>
              )}
            </div>
          </div>
        )}

        {screen === 'updating' && (
          <div className="pm-screen updating-screen">
            <div className="update-container">
              <h2>What changed?</h2>
              <p className="update-subtitle">Tell us what new information you've gathered or decisions you've made.</p>

              <textarea className="form-input update-input" placeholder="Example: We validated that 60% of users hit this daily (not just weekly). Also confirmed iOS launch needs to wait until Q2. Updated: timeline now reflects phased rollout..." rows={8} value={updateData} onChange={(e) => setUpdateData(e.target.value)} />

              <div className="update-actions">
                <button className="pm-button pm-button-secondary" onClick={() => { setScreen('viewing'); setUpdateData(''); }}>
                  Cancel
                </button>
                <button className="pm-button pm-button-primary" onClick={submitUpdate} disabled={!updateData.trim() || isGenerating}>
                  {isGenerating ? (<><Loader size={18} className="spinner" />Updating...</>) : ('Regenerate PRD')}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="pm-footer">
        <p>Otto v1.0 — $35/month, unlimited. Spend your time being a PM, not doing PM admin.</p>
      </footer>

      {showHistory && (
        <div className="history-overlay" onClick={() => setShowHistory(false)}>
          <aside className="history-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="history-drawer-header">
              <div className="history-drawer-title">
                <Clock size={18} />
                Your PRDs
                <span className="pm-header-count">{library.length}</span>
              </div>
              <button className="history-close" onClick={() => setShowHistory(false)} aria-label="Close history">
                <X size={18} />
              </button>
            </div>

            <div className="history-search">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search by title or content..."
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                autoFocus
              />
            </div>

            <div className="history-list">
              {historyResults.length === 0 ? (
                <p className="history-empty">
                  {historyQuery.trim() ? 'No PRDs match your search.' : 'No PRDs yet.'}
                </p>
              ) : (
                historyResults.map((prd) => (
                  <div
                    key={prd.id}
                    className={`history-item ${prd.id === generatedPRD?.id ? 'history-item-active' : ''}`}
                    onClick={() => openPRD(prd)}
                  >
                    <div className="history-item-main">
                      <span className="history-item-title">{prd.title}</span>
                      <div className="history-item-meta">
                        <span className="history-item-type">
                          {prd.type === 'comprehensive' ? 'Full PRD' : 'One-pager'}
                        </span>
                        <span className="history-item-time">{prd.timestamp}</span>
                      </div>
                    </div>
                    <button
                      className="history-item-delete"
                      onClick={(e) => { e.stopPropagation(); deletePRD(prd.id); }}
                      title="Forget this PRD"
                      aria-label="Forget this PRD"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default PMClaudeWorkspace;