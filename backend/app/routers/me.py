"""Account information for the signed-in user."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.accounts import account_out
from app.deps import Identity, current_account, current_identity
from app.models import User
from app.schemas import MeResponse, UserOut

router = APIRouter(prefix="/v1", tags=["account"])


@router.get("/me", response_model=MeResponse)
async def me(
    identity: Annotated[Identity, Depends(current_identity)],
    account: Annotated[User, Depends(current_account)],
) -> MeResponse:
    return MeResponse(
        user=UserOut(id=identity.auth_user_id, email=identity.email),
        account=account_out(account),
    )
