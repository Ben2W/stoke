declare const freestyleIdentityIdBrand: unique symbol;
declare const freestyleTokenIdBrand: unique symbol;
declare const freestyleTokenBrand: unique symbol;

export type FreestyleIdentityId = string & { readonly [freestyleIdentityIdBrand]: true };
export type FreestyleTokenId = string & { readonly [freestyleTokenIdBrand]: true };
export type FreestyleToken = string & { readonly [freestyleTokenBrand]: true };

export function freestyleIdentityId(value: string): FreestyleIdentityId {
  return nonEmpty(value, "Freestyle identity id") as FreestyleIdentityId;
}

export function freestyleTokenId(value: string): FreestyleTokenId {
  return nonEmpty(value, "Freestyle token id") as FreestyleTokenId;
}

export function freestyleToken(value: string): FreestyleToken {
  return nonEmpty(value, "Freestyle token") as FreestyleToken;
}

function nonEmpty(value: string, label: string): string {
  if (!value) throw new Error(`${label} must be a non-empty string`);
  return value;
}
