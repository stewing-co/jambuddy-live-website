export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data = {};
  const contentType = event.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    try {
      data = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, body: 'Invalid JSON' };
    }
  } else {
    const params = new URLSearchParams(event.body);
    data.name = params.get('name');
    data.email = params.get('email');
  }

  const { name, email } = data;
  if (!name || !email) {
    return { statusCode: 400, body: 'Missing name or email' };
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'stewing-co/jambuddy-live-website';
  if (!token || !repo) {
    return { statusCode: 500, body: 'GitHub configuration missing' };
  }

  const issueTitle = `Closed testing signup: ${name}`;
  const issueBody = `Email: ${email}\n\nUser expressed interest in closed testing.`;

  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: issueTitle, body: issueBody })
    });

    if (!response.ok) {
      const text = await response.text();
      return { statusCode: 500, body: `GitHub API error: ${text}` };
    }

    return { statusCode: 200, body: 'Signup submitted' };
  } catch (err) {
    return { statusCode: 500, body: `Server error: ${err.message}` };
  }
}
