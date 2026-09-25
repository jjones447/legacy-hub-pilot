// Cloudflare v4 REST API client wrapper for account bootstrap and automation
// Ensures strict token masking and provides mockable fetch interface.

export class CloudflareApi {
  constructor({ token, accountId, baseUrl = 'https://api.cloudflare.com/client/v4', fetchImpl = fetch } = {}) {
    if (!token) throw new Error('Cloudflare API token is required');
    this.token = token;
    this.accountId = accountId;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
  }

  sanitize(text) {
    if (!text || typeof text !== 'string') return text;
    if (!this.token) return text;
    return text.replaceAll(this.token, '[REDACTED_TOKEN]');
  }

  async request(path, { method = 'GET', body = null, headers = {} } = {}) {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const reqHeaders = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      ...headers
    };

    const init = {
      method,
      headers: reqHeaders
    };
    if (body !== null && body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    let response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (err) {
      throw new Error(`Cloudflare API request failed: ${this.sanitize(err.message)}`);
    }

    let data = null;
    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch (_) {
        data = null;
      }
    } else {
      const text = await response.text().catch(() => '');
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = text;
      }
    }

    if (!response.ok) {
      let errMsg = `HTTP ${response.status} ${response.statusText}`;
      if (data && typeof data === 'object') {
        if (Array.isArray(data.errors) && data.errors.length > 0) {
          errMsg = data.errors.map(e => e.message || JSON.stringify(e)).join('; ');
        } else if (data.message) {
          errMsg = data.message;
        }
      }
      const err = new Error(this.sanitize(errMsg));
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data?.result !== undefined ? data.result : data;
  }

  async verifyToken() {
    return this.request('/user/tokens/verify');
  }

  async getAccount(accountId = this.accountId) {
    return this.request(`/accounts/${accountId}`);
  }

  async getAccessOrg(accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/access/organizations`);
  }

  async updateAccessOrg(accountId = this.accountId, { auth_domain }) {
    return this.request(`/accounts/${accountId}/access/organizations`, {
      method: 'PUT',
      body: { auth_domain }
    });
  }

  async listIdentityProviders(accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/access/identity_providers`);
  }

  async createIdentityProvider(accountId = this.accountId, { type, name, config = {} }) {
    return this.request(`/accounts/${accountId}/access/identity_providers`, {
      method: 'POST',
      body: { type, name, config }
    });
  }

  async listAccessApps(accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/access/apps`);
  }

  async createAccessApp(accountId = this.accountId, payload) {
    return this.request(`/accounts/${accountId}/access/apps`, {
      method: 'POST',
      body: payload
    });
  }

  async listAccessPolicies(accountId = this.accountId, appId) {
    return this.request(`/accounts/${accountId}/access/apps/${appId}/policies`);
  }

  async createAccessPolicy(accountId = this.accountId, appId, payload) {
    return this.request(`/accounts/${accountId}/access/apps/${appId}/policies`, {
      method: 'POST',
      body: payload
    });
  }

  async listD1Databases(accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/d1/database`);
  }

  async createD1Database(accountId = this.accountId, { name }) {
    return this.request(`/accounts/${accountId}/d1/database`, {
      method: 'POST',
      body: { name }
    });
  }

  async queryD1(accountId = this.accountId, databaseId, sql) {
    return this.request(`/accounts/${accountId}/d1/database/${databaseId}/query`, {
      method: 'POST',
      body: { sql }
    });
  }

  async listR2Buckets(accountId = this.accountId) {
    return this.request(`/accounts/${accountId}/r2/buckets`);
  }

  async createR2Bucket(accountId = this.accountId, { name }) {
    return this.request(`/accounts/${accountId}/r2/buckets`, {
      method: 'POST',
      body: { name }
    });
  }

  async getPagesProject(accountId = this.accountId, projectName) {
    return this.request(`/accounts/${accountId}/pages/projects/${projectName}`);
  }

  async createPagesProject(accountId = this.accountId, payload) {
    return this.request(`/accounts/${accountId}/pages/projects`, {
      method: 'POST',
      body: payload
    });
  }

  async updatePagesProject(accountId = this.accountId, projectName, payload) {
    return this.request(`/accounts/${accountId}/pages/projects/${projectName}`, {
      method: 'PATCH',
      body: payload
    });
  }

  async getWorkerScript(accountId = this.accountId, scriptName) {
    return this.request(`/accounts/${accountId}/workers/scripts/${scriptName}`);
  }

  async setWorkerSubdomain(accountId = this.accountId, scriptName, enabled = false) {
    return this.request(`/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, {
      method: 'POST',
      body: { enabled }
    });
  }
}
