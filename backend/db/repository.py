from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Cluster, PlatformSetting


class ClusterRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_all(self) -> list[Cluster]:
        result = await self.session.execute(select(Cluster).order_by(Cluster.id))
        return list(result.scalars().all())

    async def get_by_name(self, name: str) -> Cluster | None:
        result = await self.session.execute(
            select(Cluster).where(Cluster.name == name)
        )
        return result.scalar_one_or_none()

    async def get_active(self) -> Cluster | None:
        result = await self.session.execute(
            select(Cluster).where(Cluster.is_active.is_(True))
        )
        c = result.scalar_one_or_none()
        if c:
            return c
        # Fall back to first cluster
        result2 = await self.session.execute(select(Cluster).order_by(Cluster.id).limit(1))
        return result2.scalar_one_or_none()

    async def create(self, data: dict) -> Cluster:
        cluster = Cluster(**{k: v for k, v in data.items() if hasattr(Cluster, k)})
        self.session.add(cluster)
        await self.session.commit()
        await self.session.refresh(cluster)
        return cluster

    async def update(self, name: str, updates: dict) -> Cluster | None:
        cluster = await self.get_by_name(name)
        if not cluster:
            return None
        for key, value in updates.items():
            if hasattr(cluster, key) and value is not None:
                setattr(cluster, key, value)
        await self.session.commit()
        await self.session.refresh(cluster)
        return cluster

    async def delete(self, name: str) -> bool:
        cluster = await self.get_by_name(name)
        if not cluster:
            return False
        await self.session.delete(cluster)
        await self.session.commit()
        return True

    async def set_active(self, name: str) -> None:
        clusters = await self.list_all()
        for c in clusters:
            c.is_active = c.name == name
        await self.session.commit()


class SettingsRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get(self, key: str) -> str | None:
        result = await self.session.execute(
            select(PlatformSetting).where(PlatformSetting.key == key)
        )
        row = result.scalar_one_or_none()
        return row.value if row else None

    async def set(self, key: str, value: str) -> None:
        result = await self.session.execute(
            select(PlatformSetting).where(PlatformSetting.key == key)
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = value
        else:
            row = PlatformSetting(key=key, value=value)
            self.session.add(row)
        await self.session.commit()

    async def get_all(self) -> dict[str, str | None]:
        result = await self.session.execute(select(PlatformSetting))
        return {row.key: row.value for row in result.scalars().all()}
