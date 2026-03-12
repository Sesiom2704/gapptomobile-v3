"""
Archivo: backend/app/repositories/bot/incidencias_repository.py
Versión: 1.1.0

Descripción:
Capa de acceso a datos para incidencias del dominio BOT.

Funcionalidades incluidas:
- Consultas de contrato, patrimonio y participante
- Validación de pertenencia persona <-> contrato
- Alta de incidencia
- Alta de histórico inicial
- Consulta de incidencia por id o código
- Listado de incidencias por contrato
- Listado de incidencias activas para gestión operativa
- Validación de gestor activo por contrato
- Alta y cierre de asignaciones de incidencia
- Actualización de responsables actuales y estado de incidencia
- Alta y consulta de citas de incidencia
- Listado de proveedores

Notas de diseño:
- Esta capa no debe contener reglas de negocio complejas.
- Se limita a leer y persistir datos usando SQLAlchemy ORM.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from backend.app.db import models


class IncidenciasBotRepository:
    def __init__(self, db: Session):
        self.db = db

    # ==========================================================
    # Lecturas de contexto
    # ==========================================================

    def get_contrato_by_id(self, contrato_id: str) -> Optional[models.Contrato]:
        return (
            self.db.query(models.Contrato)
            .filter(models.Contrato.id == contrato_id)
            .first()
        )

    def get_patrimonio_by_id(self, patrimonio_id: str) -> Optional[models.Patrimonio]:
        return (
            self.db.query(models.Patrimonio)
            .filter(models.Patrimonio.id == patrimonio_id)
            .first()
        )

    def get_persona_by_id(self, persona_id: str) -> Optional[models.Persona]:
        return (
            self.db.query(models.Persona)
            .filter(
                models.Persona.id == persona_id,
                models.Persona.inactivatedon.is_(None),
            )
            .first()
        )

    def get_contrato_participante(
        self,
        contrato_id: str,
        persona_id: str,
    ) -> Optional[models.ContratoParticipante]:
        return (
            self.db.query(models.ContratoParticipante)
            .filter(
                models.ContratoParticipante.contrato_id == contrato_id,
                models.ContratoParticipante.persona_id == persona_id,
                models.ContratoParticipante.inactivatedon.is_(None),
            )
            .first()
        )

    def get_active_gestor_for_contrato(
        self,
        contrato_id: str,
    ) -> Optional[models.ContratoParticipante]:
        """
        Devuelve el gestor activo del contrato.

        Regla funcional actual:
        - solo existe un gestor por contrato
        """
        return (
            self.db.query(models.ContratoParticipante)
            .options(joinedload(models.ContratoParticipante.persona))
            .filter(
                models.ContratoParticipante.contrato_id == contrato_id,
                models.ContratoParticipante.rol == "gestor",
                models.ContratoParticipante.inactivatedon.is_(None),
            )
            .first()
        )

    def get_proveedor_by_id(self, proveedor_id: str) -> Optional[models.Proveedor]:
        return (
            self.db.query(models.Proveedor)
            .filter(models.Proveedor.id == proveedor_id)
            .first()
        )

    def list_proveedores(
        self,
        only_active: bool = True,
        rama_id: str | None = None,
    ) -> list[models.Proveedor]:
        query = self.db.query(models.Proveedor)

        if only_active:
            query = query.filter(models.Proveedor.activo.is_(True))

        if rama_id:
            query = query.filter(models.Proveedor.rama_id == rama_id)

        return query.order_by(models.Proveedor.nombre.asc()).all()

    # ==========================================================
    # Escritura de incidencias base
    # ==========================================================

    def create_incidencia(
        self,
        *,
        incidencia_id: str,
        codigo: str,
        contrato_id: str,
        patrimonio_id: Optional[str],
        persona_reporta_id: str,
        rol_reporta: str,
        categoria: str,
        titulo: Optional[str],
        descripcion: str,
        prioridad: str,
        estado: str,
        telefono_inquilino_snapshot: Optional[str],
        notas_acceso: Optional[str],
    ):
        incidencia = models.Incidencia(
            id=incidencia_id,
            codigo=codigo,
            contrato_id=contrato_id,
            patrimonio_id=patrimonio_id,
            persona_reporta_id=persona_reporta_id,
            rol_reporta=rol_reporta,
            categoria=categoria,
            titulo=titulo,
            descripcion=descripcion,
            prioridad=prioridad,
            estado=estado,
            telefono_inquilino_snapshot=telefono_inquilino_snapshot,
            notas_acceso=notas_acceso,
        )
        self.db.add(incidencia)
        return incidencia

    def create_historial_estado(
        self,
        *,
        historial_id: str,
        incidencia_id: str,
        estado_anterior: Optional[str],
        estado_nuevo: str,
        persona_cambia_id: Optional[str],
        rol_cambia: Optional[str],
        nota: Optional[str],
    ):
        historial = models.HistorialEstadoIncidencia(
            id=historial_id,
            incidencia_id=incidencia_id,
            estado_anterior=estado_anterior,
            estado_nuevo=estado_nuevo,
            persona_cambia_id=persona_cambia_id,
            rol_cambia=rol_cambia,
            nota=nota,
        )
        self.db.add(historial)
        return historial

    # ==========================================================
    # Escritura operativa 4.3A
    # ==========================================================

    def create_cita_incidencia(
        self,
        *,
        cita_id: str,
        incidencia_id: str,
        proveedor_id: Optional[str],
        fecha_inicio_programada: datetime,
        fecha_fin_programada: Optional[datetime],
        estado_inquilino: str,
        estado_cita: str,
        propuesta_por_persona_id: Optional[str],
        confirmada_por_persona_id: Optional[str] = None,
        fecha_confirmacion: Optional[datetime] = None,
        motivo_reprogramacion: Optional[str] = None,
    ) -> models.CitaIncidencia:
        now = datetime.utcnow()

        cita = models.CitaIncidencia(
            id=cita_id,
            incidencia_id=incidencia_id,
            proveedor_id=proveedor_id,
            fecha_inicio_programada=fecha_inicio_programada,
            fecha_fin_programada=fecha_fin_programada,
            estado_inquilino=estado_inquilino,
            estado_cita=estado_cita,
            propuesta_por_persona_id=propuesta_por_persona_id,
            confirmada_por_persona_id=confirmada_por_persona_id,
            fecha_confirmacion=fecha_confirmacion,
            motivo_reprogramacion=motivo_reprogramacion,
            created_at=now,
            updated_at=now,
        )
        self.db.add(cita)
        return cita

    def close_active_assignments_by_tipo(
        self,
        *,
        incidencia_id: str,
        tipo_asignacion: str,
        fecha_desasignacion: Optional[datetime] = None,
    ) -> int:
        """
        Cierra asignaciones activas previas del mismo tipo para la incidencia.
        """
        rows = (
            self.db.query(models.AsignacionIncidencia)
            .filter(
                models.AsignacionIncidencia.incidencia_id == incidencia_id,
                models.AsignacionIncidencia.tipo_asignacion == tipo_asignacion,
                models.AsignacionIncidencia.estado == "active",
                models.AsignacionIncidencia.fecha_desasignacion.is_(None),
            )
            .all()
        )

        closing_dt = fecha_desasignacion or datetime.utcnow()

        for row in rows:
            row.estado = "inactive"
            row.fecha_desasignacion = closing_dt

        return len(rows)

    def update_incidencia_estado(
        self,
        incidencia: models.Incidencia,
        estado: str,
    ) -> models.Incidencia:
        incidencia.estado = estado
        return incidencia

    def update_incidencia_gestor_actual(
        self,
        incidencia: models.Incidencia,
        gestor_actual_id: Optional[str],
    ) -> models.Incidencia:
        incidencia.gestor_actual_id = gestor_actual_id
        return incidencia

    def update_incidencia_supervisor_actual(
        self,
        incidencia: models.Incidencia,
        supervisor_actual_id: Optional[str],
    ) -> models.Incidencia:
        incidencia.supervisor_actual_id = supervisor_actual_id
        return incidencia

    def update_incidencia_proveedor_actual(
        self,
        incidencia: models.Incidencia,
        proveedor_actual_id: Optional[str],
    ) -> models.Incidencia:
        incidencia.proveedor_actual_id = proveedor_actual_id
        return incidencia

    def create_cita_incidencia(
        self,
        *,
        cita_id: str,
        incidencia_id: str,
        proveedor_id: Optional[str],
        fecha_inicio_programada: datetime,
        fecha_fin_programada: Optional[datetime],
        estado_inquilino: str,
        estado_cita: str,
        propuesta_por_persona_id: Optional[str],
        confirmada_por_persona_id: Optional[str] = None,
        fecha_confirmacion: Optional[datetime] = None,
        motivo_reprogramacion: Optional[str] = None,
    ) -> models.CitaIncidencia:
        cita = models.CitaIncidencia(
            id=cita_id,
            incidencia_id=incidencia_id,
            proveedor_id=proveedor_id,
            fecha_inicio_programada=fecha_inicio_programada,
            fecha_fin_programada=fecha_fin_programada,
            estado_inquilino=estado_inquilino,
            estado_cita=estado_cita,
            propuesta_por_persona_id=propuesta_por_persona_id,
            confirmada_por_persona_id=confirmada_por_persona_id,
            fecha_confirmacion=fecha_confirmacion,
            motivo_reprogramacion=motivo_reprogramacion,
        )
        self.db.add(cita)
        return cita

    def create_asignacion_incidencia(
            self,
            *,
            asignacion_id: str,
            incidencia_id: str,
            tipo_asignacion: str,
            estado: str,
            gestor_id: Optional[str] = None,
            supervisor_id: Optional[str] = None,
            proveedor_id: Optional[str] = None,
            asignado_por_persona_id: Optional[str] = None,
            nota: Optional[str] = None,
        ) -> models.AsignacionIncidencia:
            now = datetime.utcnow()

            asignacion = models.AsignacionIncidencia(
                id=asignacion_id,
                incidencia_id=incidencia_id,
                gestor_id=gestor_id,
                supervisor_id=supervisor_id,
                proveedor_id=proveedor_id,
                tipo_asignacion=tipo_asignacion,
                estado=estado,
                asignado_por_persona_id=asignado_por_persona_id,
                fecha_asignacion=now,
                fecha_desasignacion=None,
                nota=nota,
            )
            self.db.add(asignacion)
            return asignacion

    # ==========================================================
    # Consultas de incidencias
    # ==========================================================

    def get_incidencia_by_id(self, incidencia_id: str) -> Optional[models.Incidencia]:
        return (
            self.db.query(models.Incidencia)
            .filter(models.Incidencia.id == incidencia_id)
            .first()
        )

    def get_incidencia_by_id_with_context(
        self,
        incidencia_id: str,
    ) -> Optional[models.Incidencia]:
        return (
            self.db.query(models.Incidencia)
            .options(
                joinedload(models.Incidencia.proveedor_actual),
                joinedload(models.Incidencia.gestor_actual),
                joinedload(models.Incidencia.supervisor_actual),
                joinedload(models.Incidencia.citas).joinedload(models.CitaIncidencia.proveedor),
            )
            .filter(models.Incidencia.id == incidencia_id)
            .first()
        )

    def get_incidencia_by_codigo(self, codigo: str) -> Optional[models.Incidencia]:
        return (
            self.db.query(models.Incidencia)
            .filter(models.Incidencia.codigo == codigo)
            .first()
        )

    def list_incidencias_by_contrato(self, contrato_id: str):
        return (
            self.db.query(
                models.Incidencia,
                models.Proveedor,
                models.Persona,
            )
            .outerjoin(
                models.Proveedor,
                models.Proveedor.id == models.Incidencia.proveedor_actual_id,
            )
            .outerjoin(
                models.Persona,
                models.Persona.id == models.Incidencia.gestor_actual_id,
            )
            .filter(models.Incidencia.contrato_id == contrato_id)
            .order_by(models.Incidencia.fecha_creacion.desc())
            .all()
        )

    def list_active_incidencias(
        self,
        *,
        estados_activos: set[str],
        gestor_persona_id: Optional[str] = None,
    ):
        query = (
            self.db.query(
                models.Incidencia,
                models.Proveedor,
                models.Persona,
            )
            .options(joinedload(models.Incidencia.patrimonio))
            .outerjoin(
                models.Proveedor,
                models.Proveedor.id == models.Incidencia.proveedor_actual_id,
            )
            .outerjoin(
                models.Persona,
                models.Persona.id == models.Incidencia.gestor_actual_id,
            )
            .filter(models.Incidencia.estado.in_(list(estados_activos)))
        )

        if gestor_persona_id:
            query = query.join(
                models.ContratoParticipante,
                models.ContratoParticipante.contrato_id == models.Incidencia.contrato_id,
            ).filter(
                models.ContratoParticipante.persona_id == gestor_persona_id,
                models.ContratoParticipante.rol == "gestor",
                models.ContratoParticipante.inactivatedon.is_(None),
            )

        return query.order_by(models.Incidencia.fecha_creacion.desc()).all()

    def get_last_cita_by_incidencia(
        self,
        incidencia_id: str,
    ) -> Optional[models.CitaIncidencia]:
        return (
            self.db.query(models.CitaIncidencia)
            .options(joinedload(models.CitaIncidencia.proveedor))
            .filter(models.CitaIncidencia.incidencia_id == incidencia_id)
            .order_by(models.CitaIncidencia.created_at.desc())
            .first()
        )

    def get_active_cita_by_incidencia(
        self,
        incidencia_id: str,
    ) -> Optional[models.CitaIncidencia]:
        return (
            self.db.query(models.CitaIncidencia)
            .options(joinedload(models.CitaIncidencia.proveedor))
            .filter(
                models.CitaIncidencia.incidencia_id == incidencia_id,
                models.CitaIncidencia.estado_cita.in_(["proposed", "confirmed", "rescheduled"]),
            )
            .order_by(models.CitaIncidencia.created_at.desc())
            .first()
        )

    # ==========================================================
    # Transaccionalidad
    # ==========================================================

    def commit(self) -> None:
        self.db.commit()

    def rollback(self) -> None:
        self.db.rollback()

    def refresh(self, instance) -> None:
        self.db.refresh(instance)