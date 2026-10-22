"""Account information for the signed-in user, and account deletion."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts import account_out
from app.config import Settings, get_settings
from app.cookies import clear_oauth_cookies, clear_session_cookies
from app.db import get_session
from app.deps import Identity, current_identity, get_auth_provider, require_session_account
from app.models import User
from app.schemas import DeleteAccountRequest, MeResponse, UserOut
from app.security import require_cookie_csrf
from app.supabase_auth import SupabaseAuth, account_deletion_unavailable

logger = logging.getLogger("quick_note.account")

router = APIRouter(prefix="/v1", tags=["account"], dependencies=[Depends(require_cookie_csrf)])

AccountDep = Annotated[User, Depends(require_session_account)]


@router.get("/me", response_model=MeResponse)
async def me(
    identity: Annotated[Identity, Depends(current_identity)],
    account: AccountDep,
) -> MeResponse:
    return MeResponse(
        user=UserOut(id=identity.auth_user_id, email=identity.email),
        account=account_out(account),
    )


@router.delete("/me", status_code=204)
async def delete_me(
    payload: DeleteAccountRequest,
    account: AccountDep,
    provider: Annotated[SupabaseAuth, Depends(get_auth_provider)],
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    """Delete the account and everything in it. Needs `{"confirm": "DELETE"}`.

    The Supabase Auth user is deleted first; the database cascades that to the
    account, its notes and its extension tokens. The account row is then deleted
    here as well, so nothing is left even if a cascade were ever missing.
    """
    if not settings.supabase_service_role_key:
        raise account_deletion_unavailable()
    await provider.delete_user(str(account.auth_user_id))
    await session.execute(delete(User).where(User.id == account.id))
    await session.commit()
    logger.info("account deleted", extra={"user_id": str(account.id)})
    response = Response(status_code=204)
    clear_session_cookies(response, settings)
    clear_oauth_cookies(response, settings)
    return response
