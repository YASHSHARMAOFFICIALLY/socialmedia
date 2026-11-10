export interface LinkedInTokenResponse {
  access_token: string; expires_in: number; scope?: string; id_token?: string;
  refresh_token?: string; refresh_token_expires_in?: number;
}
export interface LinkedInUserInfo { sub: string; name?: string; given_name?: string; family_name?: string; picture?: string; email?: string }
