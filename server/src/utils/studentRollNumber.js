const ROLL_NUMBER_PATTERN = /^UST(?<admissionYear>\d{2})R(?<branchPrefix>01\d{2})(?<serial>\d{2,3})$/;

const BRANCHES_BY_PREFIX = {
  '0101': { code: 'BTECH-AIML', name: 'B.Tech Artificial Intelligence and Machine Learning' },
  '0102': { code: 'BTECH-CSE', name: 'B.Tech Computer Science and Engineering' },
};

const BRANCH_ALIASES = {
  'BTECH-AIML': 'BTECH-AIML', AIML: 'BTECH-AIML', 'AI-ML': 'BTECH-AIML',
  'BTECH-CSE': 'BTECH-CSE', CSE: 'BTECH-CSE', CE: 'BTECH-CSE',
  'BTECH-CYS': 'BTECH-CYS', CYS: 'BTECH-CYS', CSDF: 'BTECH-CYS', CYBER: 'BTECH-CYS', 'CYBER-SECURITY': 'BTECH-CYS',
};

function normalizeRollNumber(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function parseStudentRollNumber(value) {
  const normalized = normalizeRollNumber(value);
  const match = ROLL_NUMBER_PATTERN.exec(normalized);
  if (!match) return null;

  const admissionYear = 2000 + Number(match.groups.admissionYear);
  const branchPrefix = match.groups.branchPrefix;
  const branch = BRANCHES_BY_PREFIX[branchPrefix] || {
    code: 'BTECH-CYS',
    name: 'B.Tech Cyber Security',
  };

  return { normalized, admissionYear, branchPrefix, branch };
}

function canonicalBranchCode(value) {
  if (typeof value !== 'string') return null;
  return BRANCH_ALIASES[value.trim().toUpperCase()] || null;
}

module.exports = { normalizeRollNumber, parseStudentRollNumber, canonicalBranchCode };
