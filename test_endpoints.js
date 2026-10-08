

const API = 'http://localhost:3001/api';
let studentToken, facultyToken, adminToken;

async function test() {
  console.log('--- STARTING BACKEND INTEGRATION TESTS ---');

  // 1. Auth: Register Student
  console.log('Testing: Register Student');
  let res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student99@test.com', password: 'password', fullName: 'Test Student', role: 'student' })
  });
  let data = await res.json();
  if (res.status === 409) {
    // login instead
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'student99@test.com', password: 'password' })
    });
    data = await res.json();
  }
  studentToken = data.accessToken || data.token;
  console.log('Student Token acquired:', studentToken ? 'yes' : 'no', data);

  // Register Faculty
  console.log('Testing: Register Faculty');
  res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'faculty99@test.com', password: 'password', fullName: 'Test Faculty', role: 'faculty' })
  });
  data = await res.json();
  if (res.status === 409) {
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'faculty99@test.com', password: 'password' })
    });
    data = await res.json();
  }
  facultyToken = data.accessToken;
  console.log('Faculty Token acquired.');
  
  // Register Admin
  console.log('Testing: Register Admin');
  res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin99@test.com', password: 'password', fullName: 'Test Admin', role: 'admin' })
  });
  data = await res.json();
  if (res.status === 409) {
    res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin99@test.com', password: 'password' })
    });
    data = await res.json();
  }
  adminToken = data.accessToken;
  console.log('Admin Token acquired.');

  // 2. Auth: GET /me
  console.log('Testing: GET /me');
  res = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${studentToken}` } });
  data = await res.json();
  if (!data.user) {
    console.error(data);
    throw new Error('GET /me failed');
  }
  console.log('GET /me passed.');

  // 3. Subjects / Class visibility
  console.log('Testing: Subjects for Faculty');
  res = await fetch(`${API}/subjects`, { headers: { Authorization: `Bearer ${facultyToken}` } });
  data = await res.json();
  console.log(`Faculty subjects: ${data.subjects?.length}`);

  console.log('Testing: Subjects for Student');
  res = await fetch(`${API}/subjects`, { headers: { Authorization: `Bearer ${studentToken}` } });
  let studentData = await res.json();
  console.log(`Student subjects: ${studentData.subjects?.length}`);

  let subjectId = null;
  if (data.subjects && data.subjects.length > 0) {
    subjectId = data.subjects[0].id;
  }

  // 4. Attendance Session Creation
  if (subjectId) {
    console.log('Testing: Faculty create attendance session');
    res = await fetch(`${API}/attendance/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${facultyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId, lat: 0, lng: 0 })
    });
    data = await res.json();
    console.log('Session started:', data.session?.id);

    if (data.session) {
      console.log('Testing: Student marking attendance');
      const nonce = data.session.nonce;
      res = await fetch(`${API}/attendance/mark`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: data.session.id, nonce, lat: 0, lng: 0 })
      });
      data = await res.json();
      console.log('Student marked attendance:', data.status);
    }
  }

  // 5. Ask Snippet
  if (subjectId) {
    console.log('Testing: Ask Snippet (Unrelated query)');
    res = await fetch(`${API}/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId, query: 'What is the capital of France?' })
    });
    data = await res.json();
    console.log('Ask Snippet unrelated response:', data.answer);

    console.log('Testing: Ask Snippet (Related query)');
    res = await fetch(`${API}/ask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectId, query: 'Explain the course material.' })
    });
    data = await res.json();
    console.log('Ask Snippet related response snippet:', data.answer.slice(0, 50));
    console.log('Citations:', data.sources?.length);
  } else {
    console.log('No subject found, skipping Ask Snippet tests.');
  }

  console.log('--- END OF TESTS ---');
}

test().catch(console.error);
