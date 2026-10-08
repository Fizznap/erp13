const fs = require('fs');
const FormData = require('form-data');

// Since node 18 fetch is native, wait this uses native fetch but FormData needs to be passed correctly, 
// using undici's FormData if fetch is native. Let's just require axios.

const axios = require('axios');
const API_BASE = 'https://snippet-api-pf9m.onrender.com/api';

async function testUpload() {
  const loginRes = await axios.post(API_BASE + '/auth/login', { email: 'faculty_e2e120@snippet.test', password: 'password123' });
  const token = loginRes.data.accessToken;
  
  if (!token) return console.error('Login failed');

  const subjectsRes = await axios.get(API_BASE + '/subjects', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const offerId = subjectsRes.data.subjects?.[0]?.offering_id || subjectsRes.data.subjects?.[0]?.id;
  
  if (!offerId) return console.error('No subjects found');

  fs.writeFileSync('test.pdf', 'dummy content ' + Date.now());
  
  const form = new FormData();
  form.append('subjectOfferingId', offerId);
  form.append('kind', 'Notes');
  form.append('file', fs.createReadStream('test.pdf'), { contentType: 'application/pdf', filename: 'test.pdf' });

  try {
    const uploadRes = await axios.post(API_BASE + '/resources/upload', form, {
      headers: {
        Authorization: 'Bearer ' + token,
        ...form.getHeaders()
      }
    });
    
    console.log('Upload:', uploadRes.data);
    
    const resId = uploadRes.data?.resource?.id;
    if (!resId) return console.error('No resource ID returned');

    for (let i = 0; i < 15; i++) {
      const statusRes = await axios.get(API_BASE + '/resources/' + resId + '/status', {
        headers: { Authorization: 'Bearer ' + token }
      });
      console.log('Status Polled:', statusRes.data);
      if (statusRes.data.ready || statusRes.data.error) break;
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error('Error:', err.response?.data || err.message);
  }
}
testUpload().catch(console.error);
