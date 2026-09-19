const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getGithubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const cred = execSync('git credential fill', {
      input: 'protocol=https\nhost=github.com\n',
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    });
    const match = cred.match(/password=(.+)/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

async function fetchContributionsGraphQL(username, token) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
                contributionLevel
                weekday
              }
            }
          }
        }
      }
    }
  `;

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mini-Boss-Fight-Generator'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables: { login: username } })
  });

  if (!response.ok) {
    throw new Error(`GraphQL HTTP error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data.user.contributionsCollection.contributionCalendar;
}

async function fetchContributionsFallback(username) {
  const url = `https://github-contributions-api.jogruber.de/v4/${username}?y=last`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mini-Boss-Fight-Generator' } });
  if (!response.ok) {
    throw new Error(`Fallback API HTTP error: ${response.status}`);
  }
  const data = await response.json();
  
  const days = data.contributions || [];
  const weeks = [];
  let currentWeek = { contributionDays: [] };

  days.forEach((day) => {
    const d = new Date(day.date);
    const weekday = d.getUTCDay();
    if (weekday === 0 && currentWeek.contributionDays.length > 0) {
      weeks.push(currentWeek);
      currentWeek = { contributionDays: [] };
    }
    let level = 'NONE';
    if (day.count > 0 && day.count < 3) level = 'FIRST_QUARTILE';
    else if (day.count >= 3 && day.count < 6) level = 'SECOND_QUARTILE';
    else if (day.count >= 6 && day.count < 10) level = 'THIRD_QUARTILE';
    else if (day.count >= 10) level = 'FOURTH_QUARTILE';

    currentWeek.contributionDays.push({
      date: day.date,
      contributionCount: day.count,
      contributionLevel: level,
      weekday
    });
  });
  if (currentWeek.contributionDays.length > 0) {
    weeks.push(currentWeek);
  }

  return {
    totalContributions: data.total ? data.total[Object.keys(data.total)[0]] || days.reduce((a, b) => a + b.count, 0) : days.reduce((a, b) => a + b.count, 0),
    weeks
  };
}

async function getContributionData(username) {
  const token = getGithubToken();
  if (token) {
    try {
      console.log('Fetching contributions via GitHub GraphQL API...');
      return await fetchContributionsGraphQL(username, token);
    } catch (err) {
      console.warn('GraphQL fetch failed, falling back to public endpoint:', err.message);
    }
  } else {
    console.log('No token detected, using public contributions endpoint...');
  }
  return await fetchContributionsFallback(username);
}

function calculateBossHP(totalContributions, activeDays) {
  // Easter egg game mechanic: Boss HP decreases with contribution activity
  // Keeps it visibly in an engaging battle state (between 12% and 65%)
  const damage = (totalContributions * 1.1) + (activeDays * 0.7);
  const remaining = Math.max(12, Math.round(100 - (damage % 85)));
  return remaining;
}

function generateSVG(calendar, username) {
  const total = calendar.totalContributions || 0;
  const weeks = calendar.weeks || [];

  let activeDays = 0;
  let maxDaily = 0;
  let maxStreak = 0;
  let tempStreak = 0;

  weeks.forEach(w => {
    (w.contributionDays || []).forEach(d => {
      if (d.contributionCount > 0) {
        activeDays++;
        if (d.contributionCount > maxDaily) maxDaily = d.contributionCount;
        tempStreak++;
        if (tempStreak > maxStreak) maxStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    });
  });

  const bossHP = calculateBossHP(total, activeDays);
  const barWidth = 220;
  const bossFilledWidth = Math.round((barWidth * bossHP) / 100);

  const cellColors = {
    'NONE': { fill: '#161b22', stroke: '#21262d' },
    'FIRST_QUARTILE': { fill: '#0e4429', stroke: '#006d32' },
    'SECOND_QUARTILE': { fill: '#006d32', stroke: '#26a641' },
    'THIRD_QUARTILE': { fill: '#26a641', stroke: '#39d353' },
    'FOURTH_QUARTILE': { fill: '#39d353', stroke: '#56d364' }
  };

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabels = [];
  let lastMonth = -1;

  weeks.forEach((week, wIdx) => {
    const firstDay = week.contributionDays && week.contributionDays[0];
    if (firstDay && firstDay.date) {
      const m = new Date(firstDay.date).getUTCMonth();
      if (m !== lastMonth) {
        monthLabels.push({
          name: monthNames[m],
          x: 62 + wIdx * 14
        });
        lastMonth = m;
      }
    }
  });

  let cellsSVG = '';
  weeks.forEach((week, wIdx) => {
    const x = 62 + wIdx * 14;
    (week.contributionDays || []).forEach(day => {
      const y = 152 + day.weekday * 14;
      const style = cellColors[day.contributionLevel] || cellColors['NONE'];
      const isCrit = day.contributionLevel === 'FOURTH_QUARTILE';
      const animClass = isCrit ? ' class="crit-cell"' : (day.contributionCount > 0 ? ' class="active-cell"' : '');
      cellsSVG += `\n    <rect x="${x}" y="${y}" width="10" height="10" rx="2" fill="${style.fill}" stroke="${style.stroke}" stroke-width="0.7"${animClass}>`;
      cellsSVG += `<title>${day.date}: ${day.contributionCount} contribution${day.contributionCount === 1 ? '' : 's'}</title></rect>`;
    });
  });

  let monthsSVG = '';
  monthLabels.forEach((ml, idx) => {
    if (idx === 0 || ml.x - monthLabels[idx - 1].x >= 28) {
      monthsSVG += `\n    <text x="${ml.x}" y="142" fill="#7d8590" font-size="9" font-family="ui-monospace, SFMono-Regular, monospace">${ml.name}</text>`;
    }
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 310" width="100%" height="100%">
  <defs>
    <linearGradient id="pGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#238636" />
      <stop offset="100%" stop-color="#3fb950" />
    </linearGradient>
    <linearGradient id="bGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#da3633" />
      <stop offset="100%" stop-color="#f85149" />
    </linearGradient>
    <linearGradient id="topHighlight" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#58a6ff" stop-opacity="0.5" />
      <stop offset="40%" stop-color="#58a6ff" stop-opacity="0.15" />
      <stop offset="100%" stop-color="#58a6ff" stop-opacity="0" />
    </linearGradient>
  </defs>

  <style>
    .hud-mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
    
    @keyframes pulse-crit {
      0%, 100% { opacity: 0.92; }
      50% { opacity: 1; filter: drop-shadow(0 0 3px #39d353); }
    }
    @keyframes pulse-vs {
      0%, 100% { transform: scale(1); opacity: 0.9; }
      50% { transform: scale(1.05); opacity: 1; }
    }
    .crit-cell { animation: pulse-crit 3s ease-in-out infinite; }
    .vs-badge { transform-origin: 420px 72px; animation: pulse-vs 2.5s ease-in-out infinite; }
  </style>

  <!-- Container Frame -->
  <rect x="1" y="1" width="838" height="308" rx="8" fill="#0d1117" stroke="#30363d" stroke-width="1" />
  <rect x="1" y="1" width="838" height="1.5" rx="1" fill="url(#topHighlight)" />

  <!-- Top Header Bar -->
  <g class="hud-mono">
    <circle cx="26" cy="23" r="3.5" fill="#3fb950" />
    <text x="38" y="27" fill="#e6edf3" font-size="11" font-weight="600" letter-spacing="1">BATTLEFIELD // REAL CONTRIBUTION MATRIX</text>
    <text x="805" y="27" text-anchor="end" fill="#7d8590" font-size="10">REAL COMMITS: <tspan fill="#3fb950" font-weight="700">${total}</tspan> | ACTIVE DAYS: <tspan fill="#e6edf3">${activeDays}</tspan></text>
  </g>

  <!-- Divider Line -->
  <line x1="15" y1="38" x2="825" y2="38" stroke="#21262d" stroke-width="1" />

  <!-- COMBATANTS HUD -->
  <g>
    <!-- PLAYER SIDE (JYOTIRMOY.exe) -->
    <g transform="translate(35, 52)">
      <text x="0" y="13" fill="#58a6ff" class="hud-mono" font-size="13" font-weight="700">JYOTIRMOY.exe</text>
      <text x="${barWidth}" y="13" text-anchor="end" fill="#7d8590" class="hud-mono" font-size="10">LVL 24 // DEV</text>
      
      <!-- Player HP Bar -->
      <rect x="0" y="21" width="${barWidth}" height="8" rx="2" fill="#21262d" />
      <rect x="0" y="21" width="${barWidth}" height="8" rx="2" fill="url(#pGrad)" />
      
      <text x="0" y="41" fill="#8b949e" class="hud-mono" font-size="9.5">HP 100%</text>
      <text x="${barWidth}" y="41" text-anchor="end" fill="#8b949e" class="hud-mono" font-size="9.5">READY: <tspan fill="#7ee787">[BUILD]</tspan> <tspan fill="#7ee787">[DEPLOY]</tspan></text>
    </g>

    <!-- VS / BATTLE STATUS (CENTER) -->
    <g class="vs-badge">
      <rect x="390" y="58" width="60" height="22" rx="4" fill="#161b22" stroke="#30363d" stroke-width="1" />
      <text x="420" y="73" text-anchor="middle" fill="#d29922" class="hud-mono" font-size="11" font-weight="700">⚔️ VS</text>
    </g>
    <text x="420" y="93" text-anchor="middle" fill="#7d8590" class="hud-mono" font-size="8.5">PLAYER PHASE</text>

    <!-- BOSS SIDE (BUGS.exe) -->
    <g transform="translate(585, 52)">
      <text x="0" y="13" fill="#7d8590" class="hud-mono" font-size="10">BOSS // LVL 99</text>
      <text x="${barWidth}" y="13" text-anchor="end" fill="#f85149" class="hud-mono" font-size="13" font-weight="700">BUGS.exe</text>
      
      <!-- Boss HP Bar -->
      <rect x="0" y="21" width="${barWidth}" height="8" rx="2" fill="#21262d" />
      <rect x="0" y="21" width="${bossFilledWidth}" height="8" rx="2" fill="url(#bGrad)" />
      
      <text x="0" y="41" fill="#8b949e" class="hud-mono" font-size="9.5">HP ${bossHP}%</text>
      <text x="${barWidth}" y="41" text-anchor="end" fill="#8b949e" class="hud-mono" font-size="9.5">COUNTER: <tspan fill="#ff7b72">[MERGE CONFLICT]</tspan></text>
    </g>
  </g>

  <!-- Divider Line -->
  <line x1="15" y1="112" x2="825" y2="112" stroke="#21262d" stroke-width="1" />

  <!-- MATRIX / CONTRIBUTION GRAPH -->
  <g>
    <!-- Day Labels -->
    <text x="36" y="174" fill="#6e7681" class="hud-mono" font-size="8.5">Mon</text>
    <text x="36" y="202" fill="#6e7681" class="hud-mono" font-size="8.5">Wed</text>
    <text x="36" y="230" fill="#6e7681" class="hud-mono" font-size="8.5">Fri</text>

    <!-- Month Labels -->
    ${monthsSVG}

    <!-- Actual Contribution Grid Cells -->
    ${cellsSVG}
  </g>

  <!-- Divider Line -->
  <line x1="15" y1="262" x2="825" y2="262" stroke="#21262d" stroke-width="1" />

  <!-- FOOTER / COMBAT LOG & REAL DATA FOOTNOTE -->
  <g class="hud-mono">
    <text x="35" y="283" fill="#8b949e" font-size="9.5">
      <tspan fill="#3fb950">●</tspan> ENERGY: REAL GITHUB CONTRIBUTIONS · <tspan fill="#e6edf3">${total} COMMITS</tspan> CHARGING ARENA CELLS
    </text>

    <!-- Legend -->
    <g transform="translate(620, 274)">
      <text x="0" y="9" fill="#7d8590" font-size="8.5">PWR:</text>
      <rect x="30" y="1" width="8" height="8" rx="1.5" fill="#161b22" stroke="#21262d" stroke-width="0.5" />
      <rect x="42" y="1" width="8" height="8" rx="1.5" fill="#0e4429" stroke="#006d32" stroke-width="0.5" />
      <rect x="54" y="1" width="8" height="8" rx="1.5" fill="#006d32" stroke="#26a641" stroke-width="0.5" />
      <rect x="66" y="1" width="8" height="8" rx="1.5" fill="#26a641" stroke="#39d353" stroke-width="0.5" />
      <rect x="78" y="1" width="8" height="8" rx="1.5" fill="#39d353" stroke="#56d364" stroke-width="0.5" />
      <text x="94" y="9" fill="#7d8590" font-size="8.5">CRIT</text>
    </g>

    <text x="35" y="299" fill="#484f58" font-size="8">※ Contribution matrix is your live GitHub graph. Boss fight &amp; HP are decorative Easter eggs.</text>
  </g>
</svg>`;

  return svg;
}

async function main() {
  const username = process.env.GITHUB_REPOSITORY_OWNER || 'Rvk30';
  console.log(`Generating Mini Boss Fight contribution visualization for: ${username}...`);

  try {
    const calendar = await getContributionData(username);
    console.log(`Retrieved calendar with ${calendar.totalContributions} total contributions.`);

    const svg = generateSVG(calendar, username);
    const outputDir = path.join(__dirname, '..', 'assets');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, 'contribution-boss.svg');
    fs.writeFileSync(outputPath, svg, 'utf-8');
    console.log(`Successfully generated contribution boss SVG at: ${outputPath}`);
  } catch (err) {
    console.error('Error generating contribution boss SVG:', err);
    process.exit(1);
  }
}

main();
