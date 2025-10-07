import React, { useEffect, useMemo, useRef, useState } from "react";
import OpenAI from "openai";

/** ---------- Natural language + percent transforms ---------- */
function normalizeNaturalLanguage(expr: string): { result: string; explanations: string[] } {
  let s = String(expr || "").trim().toLowerCase();
  const explanations: string[] = [];
  
  // Handle "X% of Y" pattern
  s = s.replace(/(\d+(?:\.\d+)?)%\s+of\s+(\d+(?:\.\d+)?)/g, (_m, a, b) => {
    explanations.push(`🧮 "X% of Y" pattern: ${a}% of ${b} → ${a}% × ${b}`);
    return `${a}% * ${b}`;
  });
  
  // Handle "add X% to Y" pattern
  s = s.replace(/add\s+(\d+(?:\.\d+)?)%\s+to\s+(\d+(?:\.\d+)?)/g, (_m, p, base) => {
    explanations.push(`➕ "Add X% to Y" pattern: add ${p}% to ${base} → ${base} + ${p}%`);
    return `${base} + ${p}%`;
  });
  
  // Handle "subtract X% from Y" pattern
  s = s.replace(/subtract\s+(\d+(?:\.\d+)?)%\s+from\s+(\d+(?:\.\d+)?)/g, (_m, p, base) => {
    explanations.push(`➖ "Subtract X% from Y" pattern: subtract ${p}% from ${base} → ${base} - ${p}%`);
    return `${base} - ${p}%`;
  });
  
  // Handle time phrases → minutes
  const originalTime = s;
  s = s.replace(/(\d+(?:\.\d+)?)\s*hours?/g, (_m, h) => {
    const hours = parseFloat(h);
    const minutes = hours * 60;
    explanations.push(`⏰ Time conversion: ${h} hour${hours !== 1 ? 's' : ''} = ${h} × 60 = ${minutes} minutes`);
    return `(${h} * 60)`;
  });
  
  s = s.replace(/(\d+(?:\.\d+)?)\s*mins?(?:utes)?/g, (_m, m) => {
    if (!originalTime.includes('hour')) { // Only explain if not already explained
      explanations.push(`⏱️ Time unit: ${m} minute${parseFloat(m) !== 1 ? 's' : ''} = ${m} minutes`);
    }
    return `${m}`;
  });
  
  return { result: s, explanations };
}

function transformPercents(expr: string): { out: string; notes: string[] } {
  let s = expr;
  const notes: string[] = [];
  
  // A: base +/- pct (e.g., 200 + 10%, 200 - 15%)
  s = s.replace(/(\d+(?:\.\d+)?)\s*([+\-])\s*(\d+(?:\.\d+)?)%/g, (_m, base, op, pct) => {
    const baseNum = parseFloat(base);
    const pctNum = parseFloat(pct);
    const percentageValue = baseNum * pctNum / 100;
    const finalValue = op === '+' ? baseNum + percentageValue : baseNum - percentageValue;
    
    const t = `${base} ${op} (${base} * ${pct} / 100)`;
    notes.push(`💰 Percent calculation: ${base} ${op} ${pct}%`);
    notes.push(`   → ${pct}% of ${base} = ${base} × ${pct} ÷ 100 = ${percentageValue}`);
    notes.push(`   → ${base} ${op} ${percentageValue} = ${finalValue}`);
    notes.push(`   → Mathematical form: ${t}`);
    return t;
  });
  
  // B: standalone x% (e.g., 15% becomes (15/100))
  s = s.replace(/(\d+(?:\.\d+)?)%/g, (_m, x) => {
    const xNum = parseFloat(x);
    const fractionValue = xNum / 100;
    const t = `(${x} / 100)`;
    notes.push(`📊 Percent to decimal: ${x}%`);
    notes.push(`   → ${x}% = ${x} ÷ 100 = ${fractionValue}`);
    notes.push(`   → Mathematical form: ${t}`);
    return t;
  });
  
  return { out: s, notes };
}

/** ---------- Safe evaluator (operators: + - * / ( ) .) ---------- */
function evaluateSafe(expression: string): number {
  // Clean the expression first
  let cleanExpr = expression.trim();
  if (!cleanExpr) throw new Error("Empty expression");
  
  // Check for valid characters
  if (!/^[0-9+\-*/().\s]+$/.test(cleanExpr)) {
    throw new Error("Unsupported characters in expression");
  }
  
  // Check for common syntax errors
  if (cleanExpr.includes("++") || cleanExpr.includes("--") || cleanExpr.includes("**") || cleanExpr.includes("//")) {
    throw new Error("Double operators not allowed (e.g., ++, --, **, //)");
  }
  
  // Check for operators at start/end
  if (/^[+\-*/]/.test(cleanExpr)) {
    throw new Error("Expression cannot start with an operator");
  }
  if (/[+\-*/]$/.test(cleanExpr)) {
    throw new Error("Expression cannot end with an operator");
  }
  
  // Check for consecutive operators
  if (/[+\-*/]{2,}/.test(cleanExpr)) {
    throw new Error("Consecutive operators not allowed");
  }
  
  // Basic validation for balanced parentheses
  let parenCount = 0;
  for (const char of cleanExpr) {
    if (char === '(') parenCount++;
    if (char === ')') parenCount--;
    if (parenCount < 0) throw new Error("Unbalanced parentheses");
  }
  if (parenCount !== 0) throw new Error("Unbalanced parentheses");
  
  // Check for division by zero
  if (cleanExpr.includes("/0") && !cleanExpr.includes("/0.")) {
    throw new Error("Division by zero");
  }
  
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${cleanExpr})`);
    const val = fn();
    if (typeof val !== "number" || Number.isNaN(val) || !Number.isFinite(val)) {
      throw new Error("Invalid calculation result");
    }
    return val;
  } catch (e) {
    if (e instanceof Error && e.message.includes("Division by zero")) {
      throw e;
    }
    throw new Error("Invalid mathematical expression");
  }
}

function evaluateExpression(expr: string): { result: number | string; steps: string[]; transformed: string } {
  if (!String(expr).trim()) return { result: "", steps: [], transformed: "" };
  
  const originalExpr = expr.trim();
  const steps: string[] = [];
  
  // Step 1: Show original expression
  steps.push(`📝 Original expression: "${originalExpr}"`);
  
  // Step 2: Natural language processing
  const { result: natural, explanations: naturalExplanations } = normalizeNaturalLanguage(expr);
  if (natural !== originalExpr) {
    steps.push(`🔄 Natural language processing detected:`);
    steps.push(...naturalExplanations);
    steps.push(`🔄 Final conversion: "${originalExpr}" → "${natural}"`);
  }
  
  // Step 3: Percent transformations
  const { out, notes } = transformPercents(natural);
  steps.push(...notes);
  
  if (out !== natural) {
    steps.push(`📊 Mathematical expression: ${out}`);
  }
  
  try {
    const value = evaluateSafe(out);
    
    // Step 4: Detailed evaluation with operator precedence
    const detailedSteps = getDetailedEvaluationSteps(out);
    steps.push(...detailedSteps);
    
    // Format the result nicely
    let formattedResult: string;
    if (Number.isInteger(value)) {
      formattedResult = value.toString();
    } else {
      // Round to reasonable precision
      const rounded = Math.round(value * 1000000) / 1000000;
      formattedResult = rounded.toString();
    }
    
    steps.push(`✅ Final result: ${formattedResult}`);
    return { result: formattedResult, steps, transformed: out };
  } catch (e: any) {
    steps.push(`❌ Error: ${e?.message || e}`);
    return { result: `Error: ${e?.message || e}`, steps, transformed: out };
  }
}

function getDetailedEvaluationSteps(expression: string): string[] {
  const steps: string[] = [];
  
  // Parse and evaluate step by step
  try {
    let expr = expression.replace(/\s+/g, ''); // Remove spaces
    
    // Handle parentheses first
    while (expr.includes('(')) {
      const lastOpen = expr.lastIndexOf('(');
      const closeIndex = expr.indexOf(')', lastOpen);
      if (closeIndex === -1) break;
      
      const innerExpr = expr.substring(lastOpen + 1, closeIndex);
      const innerResult = evaluateSimpleExpression(innerExpr);
      
      steps.push(`🔍 Evaluating parentheses: (${innerExpr}) = ${innerResult}`);
      expr = expr.substring(0, lastOpen) + innerResult + expr.substring(closeIndex + 1);
    }
    
    // Handle multiplication and division
    while (/[*/]/.test(expr)) {
      const match = expr.match(/(\d+(?:\.\d+)?)\s*([*/])\s*(\d+(?:\.\d+)?)/);
      if (!match) break;
      
      const [, left, op, right] = match;
      const leftNum = parseFloat(left);
      const rightNum = parseFloat(right);
      const result = op === '*' ? leftNum * rightNum : leftNum / rightNum;
      
      steps.push(`🔢 ${op === '*' ? 'Multiplication' : 'Division'}: ${left} ${op} ${right} = ${result}`);
      expr = expr.replace(match[0], result.toString());
    }
    
    // Handle addition and subtraction
    while (/[+\-]/.test(expr)) {
      const match = expr.match(/(\d+(?:\.\d+)?)\s*([+\-])\s*(\d+(?:\.\d+)?)/);
      if (!match) break;
      
      const [, left, op, right] = match;
      const leftNum = parseFloat(left);
      const rightNum = parseFloat(right);
      const result = op === '+' ? leftNum + rightNum : leftNum - rightNum;
      
      steps.push(`➕➖ ${op === '+' ? 'Addition' : 'Subtraction'}: ${left} ${op} ${right} = ${result}`);
      expr = expr.replace(match[0], result.toString());
    }
    
    return steps;
  } catch (e) {
    return [`🔍 Evaluation: ${expression}`];
  }
}

function evaluateSimpleExpression(expr: string): number {
  // Simple evaluator for parentheses content
  // eslint-disable-next-line no-new-func
  const fn = new Function(`return (${expr})`);
  return fn();
}

/** ---------- Fallback AI-like Explanations ---------- */
function getFallbackExplanation(expression: string, _result: string | number, _steps: string[]): string {
  const explanations: string[] = [];
  
  // Detect mathematical concepts
  if (expression.includes('%')) {
    explanations.push("📊 **Percentage Calculation**: This involves converting percentages to decimals and performing arithmetic operations.");
  }
  
  if (expression.includes('(') && expression.includes(')')) {
    explanations.push("🔍 **Order of Operations**: Parentheses are evaluated first, following the PEMDAS rule (Parentheses, Exponents, Multiplication, Division, Addition, Subtraction).");
  }
  
  if (expression.includes('*') || expression.includes('/')) {
    explanations.push("🔢 **Multiplication/Division**: These operations have higher precedence than addition and subtraction.");
  }
  
  if (expression.includes('+') || expression.includes('-')) {
    explanations.push("➕➖ **Addition/Subtraction**: These are performed after higher precedence operations.");
  }
  
  // Add general tips
  explanations.push("💡 **Tips**: Always follow the order of operations (PEMDAS) for accurate results.");
  explanations.push("🧮 **Verification**: You can verify your answer by working backwards or using different calculation methods.");
  
  return explanations.join('\n\n');
}

/** ---------- ChatGPT AI Explanations ---------- */
async function getChatGPTExplanation(expression: string, result: string | number, steps: string[]): Promise<string> {
  try {
    // Check if API key is configured
    const apiKey = localStorage.getItem('openai_api_key');
    if (!apiKey) {
      return getFallbackExplanation(expression, result, steps) + "\n\n⚠️ For enhanced AI explanations, please add your OpenAI API key in settings.";
    }

    const openai = new OpenAI({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true
    });

    const prompt = `
Please provide a clear, educational explanation for this math calculation:

Expression: ${expression}
Result: ${result}

Step-by-step breakdown:
${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

Please explain:
1. What mathematical concepts are being used
2. Why each step is necessary
3. Any shortcuts or tricks that could help
4. Real-world applications if applicable

Keep the explanation concise but educational, suitable for someone learning math.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful math tutor. Provide clear, educational explanations of mathematical calculations with step-by-step reasoning."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    return completion.choices[0]?.message?.content || "Sorry, I couldn't generate an explanation at this time.";
  } catch (error: any) {
    console.error('ChatGPT API Error:', error);
    
    // Handle specific error types and provide fallback
    const fallbackExplanation = getFallbackExplanation(expression, result, steps);
    
    if (error.status === 429 || error.message?.includes('quota')) {
      return fallbackExplanation + "\n\n❌ **API Quota Exceeded**: Your OpenAI account has reached its usage limit. Please check your billing details or try again later.";
    } else if (error.status === 401) {
      return fallbackExplanation + "\n\n❌ **Invalid API Key**: Please check your OpenAI API key in settings.";
    } else if (error.status === 403) {
      return fallbackExplanation + "\n\n❌ **API Access Denied**: Please check your OpenAI account status.";
    }
    
    return fallbackExplanation + `\n\n❌ **API Error**: ${error.message || 'Unknown error'}. Using fallback explanation above.`;
  }
}

/** ---------- UI ---------- */
const Button: React.FC<{ label: React.ReactNode; onClick?: () => void; className?: string; title?: string }> = ({ label, onClick, className = "", title }) => (
  <button title={title} onClick={onClick} className={`btn ${className}`}>{label}</button>
);

function useHotkeys(map: Record<string, () => void>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = `${e.ctrlKey ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.metaKey ? "Meta+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key}`;
      if (map[combo]) { e.preventDefault(); map[combo](); }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && map[e.key]) { e.preventDefault(); map[e.key](); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);
}

function useInputHotkeys(map: Record<string, () => void>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (map[e.key]) { 
        e.preventDefault(); 
        map[e.key](); 
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);
}

export default function App() {
  const [theme, setTheme] = useState<"light" | "dark" | "crt">("crt");
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<string | number>("");
  const [stepsOpen, setStepsOpen] = useState(true);
  const [history, setHistory] = useState<{ expr: string; result: string | number; ts: number }[]>([]);
  const [aiExplanation, setAiExplanation] = useState<string>("");
  const [isLoadingAI, setIsLoadingAI] = useState(false); 
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKey, setApiKey] = useState(localStorage.getItem('openai_api_key') || "");
  const inputRef = useRef<HTMLInputElement>(null);

  const { steps } = useMemo(() => evaluateExpression(expr), [expr]);

  useEffect(() => {
    const { result } = evaluateExpression(expr);
    setResult(result);
  }, [expr]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("crt", theme === "crt");
  }, [theme]);

  const append = (t: string) => {
    setExpr((s) => {
      const newExpr = s + t;
      
      // Prevent double operators
      if (t.match(/[+\-*/]/) && s.slice(-1).match(/[+\-*/]/)) {
        return s; // Don't add if last character is also an operator
      }
      
      // Prevent multiple decimal points in same number
      if (t === '.') {
        const parts = newExpr.split(/[+\-*/()]/);
        const lastPart = parts[parts.length - 1];
        if (lastPart.includes('.')) {
          return s; // Don't add if current number already has decimal
        }
      }
      
      return newExpr;
    });
  };
  
  const clear = () => setExpr("");
  const backspace = () => setExpr((s) => s.slice(0, -1));
  const compute = () => {
    const { result } = evaluateExpression(expr);
    if (result !== "") setHistory((h) => [{ expr, result, ts: Date.now() }, ...h].slice(0, 30));
  };

  const getAIExplanation = async () => {
    if (!expr.trim()) return;
    
    setIsLoadingAI(true);
    setAiExplanation("");
    
    try {
      const { result, steps } = evaluateExpression(expr);
      const explanation = await getChatGPTExplanation(expr, result, steps);
      setAiExplanation(explanation);
    } catch (error) {
      setAiExplanation("❌ Error getting AI explanation. Please try again.");
    } finally {
      setIsLoadingAI(false);
    }
  };

  const saveApiKey = () => {
    localStorage.setItem('openai_api_key', apiKey);
    setShowApiKeyModal(false);
  };

  // Global hotkeys for special functions
  useHotkeys({ 
    Enter: compute, 
    "Alt+s": () => setStepsOpen((v) => !v),
    "Escape": clear,
    "Delete": clear
  });

  // Input hotkeys for numbers and operators (with preventDefault)
  useInputHotkeys({
    "0": () => append("0"),
    "1": () => append("1"),
    "2": () => append("2"),
    "3": () => append("3"),
    "4": () => append("4"),
    "5": () => append("5"),
    "6": () => append("6"),
    "7": () => append("7"),
    "8": () => append("8"),
    "9": () => append("9"),
    "+": () => append("+"),
    "-": () => append("-"),
    "*": () => append("*"),
    "/": () => append("/"),
    ".": () => append("."),
    "(": () => append("("),
    ")": () => append(")"),
    "%": () => append("%"),
    "Backspace": backspace
  });

  // Hacker background code
  const hackerCode = [
    `> sudo rm -rf / --no-preserve-root
> ACCESS GRANTED
> INITIATING MATRIX PROTOCOL
> CONNECTING TO MAINFRAME...
> BREACHING FIREWALL...
> EXPLOITING VULNERABILITY...
> UPLOADING MALWARE...
> BACKDOOR INSTALLED
> ROOT ACCESS OBTAINED
> SYSTEM COMPROMISED
> DATA EXFILTRATED
> COVERING TRACKS...
> DISCONNECTING...`,
    
    `$ python3 exploit.py --target 192.168.1.100
[*] Scanning for vulnerabilities...
[*] Found CVE-2024-1234
[*] Exploiting buffer overflow...
[*] Shell spawned
[*] Escalating privileges...
[*] Root access gained
[*] Installing persistence...
[*] Cleanup complete`,
    
    `const hackTheWorld = () => {
  console.log("🚀 INITIATING GLOBAL HACK...");
  
  // Bypass security measures
  const security = document.querySelector('.security');
  security.style.display = 'none';
  
  // Access restricted systems
  const systems = ['bank', 'government', 'corporate'];
  systems.forEach(system => {
    console.log(\`💀 Hacking \${system}...\`);
    // Hack logic here
  });
  
  // Mission complete
  console.log("✅ WORLD DOMINATION ACHIEVED!");
};`,
    
    `#!/bin/bash
# Advanced Hacking Script
echo "🔥 STARTING CYBER ATTACK..."

# Network reconnaissance
nmap -sS -O target.com

# Vulnerability scanning
nikto -h target.com

# SQL injection attempt
sqlmap -u "target.com/login" --dbs

# Social engineering
phish_target() {
  echo "📧 Sending phishing emails..."
  # Phishing logic
}

# Final payload
payload="rm -rf /"
echo "💣 Deploying payload: $payload"`
  ];

  return (
    <div className="app">
      {/* Hacker Background Code */}
      <div className="hacker-bg">
        {hackerCode.map((code, index) => (
          <div key={index} className="hacker-code" style={{ left: `${index * 25}%`, width: '20%' }}>
            {code}
          </div>
        ))}
      </div>
      
      <div className="container grid">
        {/* Left side: calculator */}
        <div className="space">
          <div className="header">
            <div className="h1 glitch">Hackulator</div>
            <div className="row">
              <select className="select" value={theme} onChange={(e) => setTheme(e.target.value as any)}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="crt">CRT</option>
              </select>
              <Button label={stepsOpen ? "Hide Steps" : "Show Steps"} onClick={() => setStepsOpen((v) => !v)} className="btn-op" />
              <Button label="🤖 AI" onClick={getAIExplanation} className="btn-op" title="Get AI explanation" />
              <Button label="⚙️" onClick={() => setShowApiKeyModal(true)} className="btn-op" title="API Settings" />
            </div>
          </div>

          <div className="card">
            <input
              ref={inputRef}
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              placeholder='Try: 200 + 10%  |  15% of 42  |  (2 hours + 30 mins)'
              className={`input ${theme === 'crt' ? 'terminal-cursor' : ''}`}
            />
            <div className="result">{result !== "" ? `= ${result}` : ""}</div>
          </div>

          <div className="keypad">
            <Button label="AC" onClick={clear} className="btn-op" title="Clear All" />
            <Button label="⌫" onClick={backspace} className="btn-op" title="Backspace" />
            <Button label="(" onClick={() => append("(")} className="btn-op" title="Open Parenthesis" />
            <Button label=")" onClick={() => append(")")} className="btn-op" title="Close Parenthesis" />

            <Button label="7" onClick={() => append("7")} className="btn-base" />
            <Button label="8" onClick={() => append("8")} className="btn-base" />
            <Button label="9" onClick={() => append("9")} className="btn-base" />
            <Button label="÷" onClick={() => append("/")} className="btn-op" title="Divide" />

            <Button label="4" onClick={() => append("4")} className="btn-base" />
            <Button label="5" onClick={() => append("5")} className="btn-base" />
            <Button label="6" onClick={() => append("6")} className="btn-base" />
            <Button label="×" onClick={() => append("*")} className="btn-op" title="Multiply" />

            <Button label="1" onClick={() => append("1")} className="btn-base" />
            <Button label="2" onClick={() => append("2")} className="btn-base" />
            <Button label="3" onClick={() => append("3")} className="btn-base" />
            <Button label="−" onClick={() => append("-")} className="btn-op" title="Subtract" />

            <Button label="0" onClick={() => append("0")} className="btn-base" />
            <Button label="." onClick={() => append(".")} className="btn-base" title="Decimal Point" />
            <Button label="%" onClick={() => append("%")} className="btn-op" title="Percent" />
            <Button label="+" onClick={() => append("+")} className="btn-op" title="Add" />

            <Button label="=" onClick={compute} className="btn-eq" title="Equals (Enter)" />
          </div>
        </div>

        {/* Right side: steps & history */}
        <div className="space">
          <div className="card">
            <div className="header">
              <div className="h1" style={{ fontSize: 18 }}>Explanation</div>
              <div className="small">(toggle Alt+S)</div>
            </div>
            {stepsOpen ? (
              <div style={{ maxHeight: "60vh", overflow: "auto", paddingRight: 4 }}>
                {steps.length ? (
                  <div className="small" style={{ lineHeight: 1.6 }}>
                    {steps.map((step, i) => (
                      <div key={i} style={{ margin: "6px 0", padding: "4px 8px", borderRadius: "6px", backgroundColor: "rgba(0,0,0,0.03)" }}>
                        <span className="mono">{step}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="small" style={{ opacity: 0.7, fontStyle: "italic" }}>
                    Type an expression to see detailed step-by-step explanation...
                  </div>
                )}
              </div>
            ) : (
              <div className="small" style={{ opacity: 0.7, fontStyle: "italic" }}>Hidden - Press Alt+S to show</div>
            )}
          </div>

          {/* AI Explanation Section */}
          <div className="card">
            <div className="header">
              <div className="h1" style={{ fontSize: 18 }}>🤖 AI Explanation</div>
              <Button 
                label={isLoadingAI ? "⏳" : "🤖"} 
                onClick={getAIExplanation} 
                className="btn-op" 
                title={isLoadingAI ? "Loading..." : "Get AI explanation"}
              />
            </div>
            <div style={{ maxHeight: "40vh", overflow: "auto", paddingRight: 4 }}>
              {isLoadingAI ? (
                <div className="small" style={{ opacity: 0.7, fontStyle: "italic", textAlign: "center", padding: "20px" }}>
                  🤖 AI is thinking... Please wait
                </div>
              ) : aiExplanation ? (
                <div className="small" style={{ lineHeight: 1.6 }}>
                  <div className="ai-explanation">
                    {aiExplanation.split('\n').map((line, i) => (
                      <div key={i} style={{ margin: "4px 0" }}>
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="small" style={{ opacity: 0.7, fontStyle: "italic", textAlign: "center", padding: "20px" }}>
                  Click the 🤖 button to get an AI-powered explanation of your calculation
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="h1" style={{ fontSize: 18, marginBottom: 8 }}>History</div>
            <div style={{ maxHeight: "50vh", overflow: "auto", paddingRight: 4, display: "grid", gap: 8 }}>
              {history.length === 0 && <div className="small">No history yet. Compute something with "="</div>}
              {history.map((h, idx) => (
                <div key={idx} className="history-item" onClick={() => setExpr(h.expr)}>
                  <div className="small">{new Date(h.ts).toLocaleTimeString()}</div>
                  <div className="mono small">{h.expr}</div>
                  <div className="small">= {h.result}</div>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <Button label="Clear" onClick={() => setHistory([])} className="btn-op" />
              <Button label="AC" onClick={clear} className="btn-op" />
            </div>
          </div>
        </div>
      </div>

      {document.documentElement.classList.contains("crt") && <div className="scan" />}

      {/* API Key Configuration Modal */}
      {showApiKeyModal && (
        <div className="modal-overlay">
          <div className="card" style={{ maxWidth: '500px', width: '90%', margin: '20px' }}>
            <div className="header">
              <div className="h1" style={{ fontSize: 20 }}>🔑 OpenAI API Configuration</div>
            </div>
            
            <div style={{ marginBottom: '16px' }}>
              <div className="small" style={{ marginBottom: '8px' }}>
                Enter your OpenAI API key to enable AI explanations:
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="api-key-input"
              />
              <div className="small" style={{ marginTop: '8px', opacity: 0.7 }}>
                Your API key is stored locally in your browser and never shared.
                <br />
                Get your API key from: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI Platform</a>
                <br />
                <strong>Note:</strong> If you see quota errors, check your OpenAI billing at <a href="https://platform.openai.com/account/billing" target="_blank" rel="noopener noreferrer">OpenAI Billing</a>
              </div>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: '12px' }}>
              <Button 
                label="Cancel" 
                onClick={() => setShowApiKeyModal(false)} 
                className="btn-op" 
              />
              <Button 
                label="Save" 
                onClick={saveApiKey} 
                className="btn-eq" 
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
