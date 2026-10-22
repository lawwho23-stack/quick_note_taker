"""Extension tokens (managed by the website) and the extension's status check."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.deps import Principal, require_extension, require_session_account
from app.extension_tokens import ExtensionTokenStore, get_token_store, token_out
from app.models import User
from app.schemas import (
    ExtensionStatus,
    ExtensionTokenCreate,
    ExtensionTokenCreated,
    ExtensionTokenList,
)
from app.security import require_cookie_csrf

router = APIRouter(prefix="/v1", dependencies=[Depends(require_cookie_csrf)])

AccountDep = Annotated[User, Depends(require_session_account)]
TokenStoreDep = Annotated[ExtensionTokenStore, Depends(get_token_store)]


@router.post(
    "/extension-tokens",
    response_model=ExtensionTokenCreated,
    status_code=201,
    tags=["extension"],
)
async def create_extension_token(
    account: AccountDep,
    store: TokenStoreDep,
    payload: ExtensionTokenCreate | None = None,
) -> ExtensionTokenCreated:
    """Create a token for the extension. The secret is in this response only."""
    label = payload.label if payload else None
    token, secret = await store.create(account.id, label)
    listed = token_out(token)
    return ExtensionTokenCreated(
        id=listed.id,
        label=listed.label,
        scopes=listed.scopes,
        created_at=listed.created_at,
        token=secret,
    )


@router.get("/extension-tokens", response_model=ExtensionTokenList, tags=["extension"])
async def list_extension_tokens(account: AccountDep, store: TokenStoreDep) -> ExtensionTokenList:
    """Active tokens only. Secrets are never stored, so they can never be listed."""
    return ExtensionTokenList(items=[token_out(t) for t in await store.list_active(account.id)])


@router.delete("/extension-tokens/{token_id}", status_code=204, tags=["extension"])
async def revoke_extension_token(
    token_id: uuid.UUID, account: AccountDep, store: TokenStoreDep
) -> Response:
    await store.revoke(account.id, token_id)
    return Response(status_code=204)


@router.get("/extension/status", response_model=ExtensionStatus, tags=["extension"])
async def extension_status(
    _principal: Annotated[Principal, Depends(require_extension)],
) -> ExtensionStatus:
    """Lets the extension check its token. A bad or revoked token is a 401."""
    return ExtensionStatus()
