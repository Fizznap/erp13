const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');

const BASE_URL = 'https://snippet-api-pf9m.onrender.com/api';

async function apiCall(endpoint, method, body, token, isFormData = false) {
  const headers = { 'X-Forwarded-For': `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}` };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData && body) {
    headers['Content-Type'] = 'application/json';
  } else if (isFormData && body && typeof body.getHeaders === 'function') {
    Object.assign(headers, body.getHeaders());
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined)
  });

  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch (e) {
    return { status: res.status, text };
  }
}

async function runTests() {
  console.log("=== STARTING E2E INTEGRATION TESTS ===");
  const report = {};

  try {
    console.log("Registering Admin...");
    let adminRes = await apiCall('/auth/register', 'POST', {
      email: 'admin_test120@snippet.test', password: 'password123', fullName: 'Admin User', role: 'admin'
    });
    
    const adminLogin = await apiCall('/auth/login', 'POST', { email: 'admin_test120@snippet.test', password: 'password123' });
    const adminToken = adminLogin.data.accessToken;
    report['LOGIN_ADMIN'] = adminToken ? 'PASS' : 'FAIL';

    console.log("Creating Academic Hierarchy...");
    const branchRes = await apiCall('/academic/branches', 'POST', { name: 'CSE_TEST120', code: 'CSET120' }, adminToken);
    const batchRes = await apiCall('/academic/batches', 'POST', { name: '2110-2114-120', code: '2428120', startYear: 2110, endYear: 2114 }, adminToken);
    const divARes = await apiCall('/academic/divisions', 'POST', { name: 'DivA120' }, adminToken);
    const divBRes = await apiCall('/academic/divisions', 'POST', { name: 'DivB120' }, adminToken);
    const sem5Res = await apiCall('/academic/semesters', 'POST', { number: 120 }, adminToken);

    const classARes = await apiCall('/academic/classes', 'POST', {
      branchId: branchRes.data.branch?.id,
      batchId: batchRes.data.batch?.id,
      divisionId: divARes.data.division?.id,
      semesterId: sem5Res.data.semester?.id
    }, adminToken);
    
    console.log("Class A:", classARes);

    const classBRes = await apiCall('/academic/classes', 'POST', {
      branchId: branchRes.data.branch?.id,
      batchId: batchRes.data.batch?.id,
      divisionId: divBRes.data.division?.id,
      semesterId: sem5Res.data.semester?.id
    }, adminToken);
    
    console.log("Class B:", classBRes);

    report['ADMIN_ACADEMIC_MANAGEMENT'] = (classARes.status === 201 && classBRes.status === 201) ? 'PASS' : `FAIL: ${JSON.stringify(classARes.data)}`;

    console.log("Creating Faculty...");
    const facRes = await apiCall('/auth/register', 'POST', {
      email: 'faculty_e2e120@snippet.test', password: 'password123', fullName: 'Faculty E2E', role: 'faculty'
    });
    const facToken = facRes.data.accessToken;
    const facId = facRes.data.user.id;

    console.log("Creating Subject & Offerings...");
    const subRes = await apiCall('/subjects', 'POST', { name: 'Database Management Systems 120', code: 'DBMS_E2E120', description: 'DB Test' }, facToken);
    const subjectId = subRes.data.id || subRes.data.subject?.id;

    const offerARes = await apiCall(`/subjects/offerings`, 'POST', {
      subjectId, academicClassId: classARes.data.academicClass?.id, facultyId: facId
    }, adminToken);

    const offerBRes = await apiCall(`/subjects/offerings`, 'POST', {
      subjectId, academicClassId: classBRes.data.academicClass?.id, facultyId: facId
    }, adminToken);
    console.log("Offer A:", offerARes);
    console.log("Offer B:", offerBRes);

    report['FACULTY_CLASS_MANAGEMENT'] = (offerARes.status === 201 && offerBRes.status === 201) ? 'PASS' : `FAIL: ${JSON.stringify(offerARes.data)}`;
    
    const offerAId = offerARes.data.offering?.id || offerARes.data.id;
    const offerBId = offerBRes.data.offering?.id || offerBRes.data.id;

    console.log("Creating Students...");
    const stuARes = await apiCall('/auth/register', 'POST', { email: 'studentA_e2e120@snippet.test', password: 'password123', fullName: 'Student A', role: 'student' });
    const stuAToken = stuARes.data.accessToken;
    const stuBRes = await apiCall('/auth/register', 'POST', { email: 'studentB_e2e120@snippet.test', password: 'password123', fullName: 'Student B', role: 'student' });
    const stuBToken = stuBRes.data.accessToken;

    const assignARes = await apiCall(`/admin/users/${stuARes.data.user.id}/class`, 'PATCH', { academicClassId: classARes.data.academicClass?.id }, adminToken);
    const assignBRes = await apiCall(`/admin/users/${stuBRes.data.user.id}/class`, 'PATCH', { academicClassId: classBRes.data.academicClass?.id }, adminToken);

    report['ONBOARDING'] = (assignARes.status === 200 && assignBRes.status === 200) ? 'PASS' : `FAIL: ${JSON.stringify(assignARes.data)}`;

    const profileRes = await apiCall('/auth/me', 'PATCH', { fullName: 'Student B Updated' }, stuBToken);
    console.log("Profile Res:", profileRes);
    report['PROFILE_EDIT'] = profileRes.data.user?.fullName === 'Student B Updated' ? 'PASS' : `FAIL: ${JSON.stringify(profileRes.data)}`;

    console.log("Uploading Resources...");
    fs.writeFileSync('divA.pdf', 'DIVISION_A_ONLY_TEST context for rag.');
    const formA = new FormData();
    formA.append('subjectOfferingId', offerAId);
    formA.append('file', fs.createReadStream('divA.pdf'), { contentType: 'application/pdf', filename: 'divA.pdf' });
    
    const upARes = await apiCall('/resources/upload', 'POST', formA, facToken, true);

    fs.writeFileSync('divB.pdf', 'SNIPPET_RAG_TEST_2026_DIV_B context for rag.');
    const formB = new FormData();
    formB.append('subjectOfferingId', offerBId);
    formB.append('file', fs.createReadStream('divB.pdf'), { contentType: 'application/pdf', filename: 'divB.pdf' });
    
    const upBRes = await apiCall('/resources/upload', 'POST', formB, facToken, true);

    report['AUTHORIZED_RESOURCE_UPLOAD'] = (upARes.status === 201 && upBRes.status === 201) ? 'PASS' : `FAIL: ${JSON.stringify(upARes.data)}`;
    
    console.log("Checking Resource Visibility...");
    const resListA = await apiCall(`/resources?subjectOfferingId=${offerAId}`, 'GET', null, stuAToken);
    const resListB = await apiCall(`/resources?subjectOfferingId=${offerBId}`, 'GET', null, stuBToken);
    
    if (!resListA.data.resources) console.log("List A Error:", resListA.data);
    if (!resListB.data.resources) console.log("List B Error:", resListB.data);
    
    const aSeesOnlyA = resListA.data.resources ? resListA.data.resources.every(r => r.subject_offering_id === offerAId) : false;
    const bSeesOnlyB = resListB.data.resources ? resListB.data.resources.every(r => r.subject_offering_id === offerBId) : false;
    report['RESOURCE_SEGREGATION'] = (aSeesOnlyA && bSeesOnlyB) ? 'PASS' : 'FAIL';

    console.log("Testing Attendance...");
    const startAttRes = await apiCall('/attendance/start', 'POST', {
      subjectOfferingId: offerAId,
      latitude: 40.7128, longitude: -74.0060, radiusMeters: 50
    }, facToken);
    
    const sessionId = startAttRes.data.session?.id;
    const nonce = startAttRes.data.session?.active_nonce;

    if (sessionId && nonce) {
      const markARes = await apiCall('/attendance/mark', 'POST', {
        sessionId, nonce, latitude: 40.7128, longitude: -74.0060
      }, stuAToken);
      if (markARes.status !== 200) console.log("Mark A Error:", markARes.data);
      
      const markBRes = await apiCall('/attendance/mark', 'POST', {
        sessionId, nonce, latitude: 40.7128, longitude: -74.0060
      }, stuBToken);

      report['ATTENDANCE'] = (markARes.status === 200 && markBRes.status === 403) ? 'PASS' : `FAIL A: ${markARes.status}, B: ${markBRes.status}`;
    } else {
      report['ATTENDANCE'] = `FAIL: Session start failed: ${JSON.stringify(startAttRes.data)}`;
    }

  } catch (err) {
    console.error(err);
    report['FATAL_ERROR'] = err.message;
  } finally {
    console.log("\n=== E2E REPORT ===");
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
}

runTests();
