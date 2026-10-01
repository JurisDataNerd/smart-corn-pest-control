from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import List, Dict, Any
from datetime import datetime

from backend.app.db.session import get_db
from backend.app.models.trap import Trap, InspectionLog
from backend.app.schemas.trap import TrapBase, TrapCreate, TrapDetail, TrapAnalytics, InspectionLogItem

router = APIRouter()

@router.get("", response_model=List[TrapDetail], summary="List all registered traps")
async def list_traps(db: AsyncSession = Depends(get_db)):
    stmt = select(Trap).options(selectinload(Trap.inspections)).order_by(Trap.created_at.desc())
    result = await db.execute(stmt)
    traps = result.scalars().all()
    
    response_list = []
    for t in traps:
        recent = [
            InspectionLogItem(
                id=insp.id,
                trap_id=insp.trap_id,
                captured_at=insp.captured_at,
                source_type=insp.source_type,
                image_url=insp.image_url,
                annotated_image_url=insp.annotated_image_url,
                total_pests=insp.total_pests,
                risk_level=insp.risk_level,
                primary_action=insp.primary_action,
                species_counts=insp.species_counts or {},
                ocr_detected_id=insp.ocr_detected_id
            ) for insp in (t.inspections[:5] if t.inspections else [])
        ]
        
        last_insp = t.inspections[0].captured_at if t.inspections else None
        
        response_list.append(TrapDetail(
            id=t.id,
            name=t.name,
            location=t.location,
            crop_type=t.crop_type,
            trap_type=t.trap_type,
            status=t.status,
            created_at=t.created_at,
            last_inspection_at=last_insp,
            recent_inspections=recent
        ))
    return response_list

@router.post("", response_model=TrapDetail, status_code=status.HTTP_201_CREATED, summary="Register a new smart trap")
async def create_trap(trap_in: TrapCreate, db: AsyncSession = Depends(get_db)):
    stmt = select(Trap).where(Trap.id == trap_in.id)
    res = await db.execute(stmt)
    if res.scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"Trap ID '{trap_in.id}' is already registered")

    trap = Trap(
        id=trap_in.id,
        name=trap_in.name,
        location=trap_in.location,
        crop_type=trap_in.crop_type,
        trap_type=trap_in.trap_type,
        status=trap_in.status
    )
    db.add(trap)
    await db.commit()
    await db.refresh(trap)
    return TrapDetail(
        id=trap.id,
        name=trap.name,
        location=trap.location,
        crop_type=trap.crop_type,
        trap_type=trap.trap_type,
        status=trap.status,
        created_at=trap.created_at,
        last_inspection_at=None,
        recent_inspections=[]
    )

@router.get("/analytics/overview", response_model=TrapAnalytics, summary="Get IPM pest distribution and alert analytics")
async def get_trap_analytics(db: AsyncSession = Depends(get_db)):
    traps_stmt = select(Trap)
    traps_res = await db.execute(traps_stmt)
    traps = traps_res.scalars().all()
    
    inspections_stmt = select(InspectionLog).order_by(InspectionLog.captured_at.desc())
    inspections_res = await db.execute(inspections_stmt)
    inspections = inspections_res.scalars().all()
    
    total_pests = 0
    species_totals: Dict[str, int] = {}
    critical_traps = 0
    recent_alerts = []
    
    for insp in inspections:
        total_pests += (insp.total_pests or 0)
        counts = insp.species_counts or {}
        for sp, cnt in counts.items():
            species_totals[sp] = species_totals.get(sp, 0) + cnt
            
        if insp.risk_level in ["HIGH", "CRITICAL"] and len(recent_alerts) < 6:
            recent_alerts.append({
                "trap_id": insp.trap_id,
                "timestamp": insp.captured_at.isoformat() if insp.captured_at else None,
                "risk_level": insp.risk_level,
                "total_pests": insp.total_pests,
                "action": insp.primary_action
            })

    # Count traps currently in critical status
    for t in traps:
        if t.status == "needs_replacement":
            critical_traps += 1

    sorted_species = dict(sorted(species_totals.items(), key=lambda item: item[1], reverse=True)[:6])
    
    return TrapAnalytics(
        total_traps=len(traps),
        active_traps=len([t for t in traps if t.status == "active"]),
        critical_traps=critical_traps,
        total_pests_monitored=total_pests,
        top_pest_species=sorted_species,
        species_trend=[
            {"species": k, "count": v} for k, v in sorted_species.items()
        ],
        recent_alerts=recent_alerts
    )

@router.get("/{trap_id}", response_model=TrapDetail, summary="Get trap details by ID")
async def get_trap_detail(trap_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Trap).options(selectinload(Trap.inspections)).where(Trap.id == trap_id)
    res = await db.execute(stmt)
    trap = res.scalar_one_or_none()
    
    if not trap:
        raise HTTPException(status_code=404, detail=f"Trap '{trap_id}' not found")
        
    recent = [
        InspectionLogItem(
            id=insp.id,
            trap_id=insp.trap_id,
            captured_at=insp.captured_at,
            source_type=insp.source_type,
            image_url=insp.image_url,
            annotated_image_url=insp.annotated_image_url,
            total_pests=insp.total_pests,
            risk_level=insp.risk_level,
            primary_action=insp.primary_action,
            species_counts=insp.species_counts or {},
            ocr_detected_id=insp.ocr_detected_id
        ) for insp in (trap.inspections if trap.inspections else [])
    ]
    
    last_insp = trap.inspections[0].captured_at if trap.inspections else None
    
    return TrapDetail(
        id=trap.id,
        name=trap.name,
        location=trap.location,
        crop_type=trap.crop_type,
        trap_type=trap.trap_type,
        status=trap.status,
        created_at=trap.created_at,
        last_inspection_at=last_insp,
        recent_inspections=recent
    )

@router.delete("/{trap_id}", summary="Delete a trap and its history")
async def delete_trap(trap_id: str, db: AsyncSession = Depends(get_db)):
    stmt = select(Trap).where(Trap.id == trap_id)
    res = await db.execute(stmt)
    trap = res.scalar_one_or_none()
    if not trap:
        raise HTTPException(status_code=404, detail=f"Trap '{trap_id}' not found")
    await db.delete(trap)
    await db.commit()
    return {"status": "deleted", "trap_id": trap_id}
