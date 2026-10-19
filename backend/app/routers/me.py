"""Account information for the signed-in user."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.deps import Identity, current_account, current_identity
from app.models import User
from app.schemas import AccountOut, MeResponse, UserOut

router = APIRouter(prefix="/v1", tags=["account"])


def _account_out(account: User) -> AccountOut:
    return AccountOut(id=str(account.id), email=account.email, created_at=account.created_at)


@router.get("/me", response_model=MeResponse)
async def me(
    identity: Annotated[Identity, Depends(current_identity)],
    account: Annotated[User, Depends(current_account)],
) -> MeResponse:
    return MeResponse(
        user=UserOut(id=identity.auth_user_id, email=identity.email),
        account=_account_out(account),
    )
