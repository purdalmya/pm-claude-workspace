import React, { useState, useRef } from 'react';
import { Copy, Download, Plus, ArrowRight, AlertCircle, Loader } from 'lucide-react';
import './PMClaudeWorkspace.css';

const PMClaudeWorkspace = () => {
  const [screen, setScreen] = useState('type-select');
  const [prdType, setPrdType] = useState(null);
  const [formData, setFormData] = useState({});
  const [generatedPRD, setGeneratedPRD] = useState(null);
  const [validationMessage, setValidationMessage] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [updateData, setUpdateData] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const prdContentRef = useRef(null);

  const API_KEY = 'sk-ant-api03-LxBSNGKN6htrUGqw';

  const comprehensiveFields = [
    { key: 'problem', label: 'PROBLEM BRIEF', placeholder: 'Describe the core problem the user is trying to solve', rows: 3 },
    { key: 'evidence', label: 'EVIDENCE (if you have it)', placeholder: 'Quantitative: What metrics show this is real?\nQualitative: User quotes or research findings', rows: 3 },
    { key: 'targetUser', label: 'TARGET USER', placeholder: 'Who experiences this problem? What\'s their role/context?', rows: 2 },
    { key: 'solutionIdea', label: 'INITIAL SOLUTION IDEA (optional)', placeholder: 'What are you thinking of building? Or leave blank for suggestions.', rows: 2 },
    { key: 'constraints', label: 'CONSTRAINTS', placeholder: 'Timeline, team size, platform limitations, budget, dependencies', rows: 2 },
    { key: 'competitors', label: 'COMPETITORS', placeholder: 'Who else is solving this? How? What are they missing?', rows: 2 },
    { key: 'strategic', label: 'STRATEGIC CONTEXT', placeholder: 'Why does your company care about this? How does it fit your roadmap?', rows: 2 },
  ];

  const shortFields = [
    { key: 'problem', label: 'PROBLEM', placeholder: 'One or two sentences. What\'s the actual pain point?', rows: 2 },
    { key: 'who', label: 'WHO', placeholder: 'One user type. Who experiences this problem?', rows: 1 },
    { key: 'evidence', label: 'EVIDENCE', placeholder: 'One number or one user quote. That\'s it.', rows: 1 },
    { key: 'idea', label: 'IDEA', placeholder: 'What are you thinking of building?', rows: 2 },
    { key: 'timeline', label: 'TIMELINE', placeholder: 'When does this need to ship?', rows: 1 },
    { key: 'constraints', label: 'CONSTRAINTS', placeholder: 'What can\'t change? (Team size, budget, platforms, dependencies)', rows: 2 },
  ];

  const fields = prdType === 'comprehensive' ? comprehensiveFields : shortFields;

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

    setIsGenerating(true);
    setScreen('generating');

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

    const systemPrompt = prdType === 'comprehensive'
      ? `You are a senior product manager at a tier-1 tech company. Generate a detailed PRD that makes decisions visible and flags unknowns. Include sections: Problem Statement, Problem Exploration, Value Proposition, Solution Overview, Success Metrics, Scope, Design & Technical Approach, Timeline, Go-to-Market, Dependencies, Open Questions, and Appendix.`
      : `You are a scrappy product manager who values speed and clarity. Generate a one-pager PRD that's immediately actionable with sections: Problem, Value Proposition, Solution, Who, Success Metrics, Scope, Risks, and Open Questions.`;

    const userPrompt = `${systemPrompt}\n\nHere's the brief:\n${briefContent}`;

    try {
      const response = await fetch('https://cors-anywhere.herokuapp.com/https://api.anthropic.com/v1/messages', {        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      const data = await response.json();
      const prdText = data.content[0].text;

      setGeneratedPRD({
        content: prdText,
        type: prdType,
        timestamp: new Date().toLocaleString(),
        originalBrief: formData,
      });

      setScreen('viewing');
    } catch (error) {
      setValidationMessage(`Error generating PRD: ${error.message}`);
      setScreen('form');
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

    const updatePrompt = `I have a ${prdType} PRD that needs updating.

ORIGINAL PRD:
${generatedPRD.content}

UPDATED INFORMATION:
${updateData}

Please regenerate the full PRD incorporating this new information.`;

    try {
      const response = await fetch('https://cors-anywhere.herokuapp.com/https://api.anthropic.com/v1/messages', {        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          messages: [{ role: 'user', content: updatePrompt }],
        }),
      });

      const data = await response.json();
      const updatedPRD = data.content[0].text;

      setGeneratedPRD(prev => ({
        ...prev,
        content: updatedPRD,
        timestamp: new Date().toLocaleString(),
      }));

      setUpdateData('');
      setScreen('viewing');
    } catch (error) {
      setValidationMessage(`Error updating PRD: ${error.message}`);
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
    setScreen('type-select');
    setPrdType(null);
    setFormData({});
    setGeneratedPRD(null);
    setValidationMessage(null);
    setUpdateData('');
  };

  return (
    <div className="pm-workspace">
      <header className="pm-header">
        <div className="pm-header-content">
          <h1 className="pm-logo">PM Claude Workspace</h1>
          <p className="pm-tagline">Generate PRDs that force clarity</p>
        </div>
        {screen !== 'type-select' && (
          <button className="pm-reset-btn" onClick={resetFlow}>
            Start Over
          </button>
        )}
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
            </div>
          </div>
        )}

        {screen === 'form' && (
          <div className="pm-screen form-screen">
            <div className="form-container">
              <h2>Let's build your {prdType === 'comprehensive' ? 'comprehensive PRD' : 'one-pager'}</h2>
              <p className="form-subtitle">The better your input, the better your PRD. Be specific. If you don't have an answer, say so.</p>

              {validationMessage && (
                <div className="pm-validation-message">
                  <AlertCircle size={18} />
                  {validationMessage}
                </div>
              )}

              <form className="pm-form">
                {fields.map(field => (
                  <div key={field.key} className="form-group">
                    <label className="form-label">{field.label}</label>
                    <textarea className="form-input" placeholder={field.placeholder} rows={field.rows} value={formData[field.key] || ''} onChange={(e) => handleFormChange(field.key, e.target.value)} />
                  </div>
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
              <h2>Generating your PRD...</h2>
              <p>This usually takes 10-15 seconds. We're thinking like a senior PM.</p>
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

              <div className="prd-content" ref={prdContentRef}>
                {generatedPRD.content.split('\n').map((line, idx) => {
                  if (line.includes('OPEN QUESTIONS') || line.includes('Open Questions')) {
                    return <h3 key={idx} className="prd-section-highlight">{line}</h3>;
                  }
                  if (line.startsWith('##')) {
                    return <h2 key={idx}>{line.replace(/^#+\s*/, '')}</h2>;
                  }
                  if (line.startsWith('###')) {
                    return <h3 key={idx}>{line.replace(/^#+\s*/, '')}</h3>;
                  }
                  if (line.startsWith('#')) {
                    return <h3 key={idx}>{line.replace(/^#+\s*/, '')}</h3>;
                  }
                  if (line.startsWith('-')) {
                    return <li key={idx}>{line.replace(/^-\s*/, '')}</li>;
                  }
                  if (line.trim() === '') {
                    return <br key={idx} />;
                  }
                  return <p key={idx}>{line}</p>;
                })}
              </div>
            </div>
          </div>
        )}

        {screen === 'updating' && (
          <div className="pm-screen updating-screen">
            <div className="update-container">
              <h2>What changed?</h2>
              <p className="update-subtitle">Tell us what new information you've gathered or decisions you've made. We'll regenerate the PRD.</p>

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
        <p>PM Claude Workspace v1.0 — $35/month for unlimited PRD generations</p>
      </footer>
    </div>
  );
};

export default PMClaudeWorkspace;