"""
Ruta: backend/app/repositories/bot/incidencias_repository.py
Versión: 1.3.0
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
- Actualización de estado/confirmación de citas
- Listado de proveedores
- Alta mínima de proveedor para flujo BOT
- Fase 4.3C:
  - Registro de notas de incidencia
  - Lectura y alta de presupuestos
  - Actualización de revisión de presupuesto
  - Resultado de visita sobre cita
  - Fecha de cierre de incidencia

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

    def get_contrato_participante_by_rol(
        self,
        contrato_id: str,
        persona_id: str,
        rol: str,
    ) -> Optional[models.ContratoParticipante]:
        return (
            self.db.query(models.ContratoParticipante)
            .filter(
                models.ContratoParticipante.contrato_id == contrato_id,
                models.ContratoParticipante.persona_id == persona_id,
                models.ContratoParticipante.rol == rol,
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

    def get_proveedor_by_nombre(
        self,
        nombre: str,
        user_id: int | None = None,
    ) -> Optional[models.Proveedor]:
        query = self.db.query(models.Proveedor).filter(models.Proveedor.nombre == nombre)

        if user_id is not None:
            query = query.filter(models.Proveedor.user_id == user_id)

        return query.first()

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

    def create_nota_incidencia(
        self,
        *,
        nota_id: str,
        incidencia_id: str,
        autor_persona_id: Optional[str],
        autor_rol: Optional[str],
        tipo_nota: str,
        nota: str,
        visible_para_inquilino: bool,
    ) -> models.NotaIncidencia:
        row = models.NotaIncidencia(
            id=nota_id,
            incidencia_id=incidencia_id,
            autor_persona_id=autor_persona_id,
            autor_rol=autor_rol,
            tipo_nota=tipo_nota,
            nota=nota,
            visible_para_inquilino=visible_para_inquilino,
        )
        self.db.add(row)
        return row

    # ==========================================================
    # Escritura operativa 4.3A / 4.3B / 4.3C
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

    def update_cita_estado(
        self,
        cita: models.CitaIncidencia,
        estado_cita: str,
    ) -> models.CitaIncidencia:
        cita.estado_cita = estado_cita
        cita.updated_at = datetime.utcnow()
        return cita

    def update_cita_estado_inquilino(
        self,
        cita: models.CitaIncidencia,
        estado_inquilino: str,
    ) -> models.CitaIncidencia:
        cita.estado_inquilino = estado_inquilino
        cita.updated_at = datetime.utcnow()
        return cita

    def update_cita_confirmacion(
        self,
        cita: models.CitaIncidencia,
        *,
        confirmada_por_persona_id: Optional[str],
        fecha_confirmacion: Optional[datetime],
    ) -> models.CitaIncidencia:
        cita.confirmada_por_persona_id = confirmada_por_persona_id
        cita.fecha_confirmacion = fecha_confirmacion
        cita.updated_at = datetime.utcnow()
        return cita

    def update_cita_fechas(
        self,
        cita: models.CitaIncidencia,
        *,
        fecha_inicio_programada: datetime,
        fecha_fin_programada: Optional[datetime],
    ) -> models.CitaIncidencia:
        cita.fecha_inicio_programada = fecha_inicio_programada
        cita.fecha_fin_programada = fecha_fin_programada
        cita.updated_at = datetime.utcnow()
        return cita

    def update_cita_motivo_reprogramacion(
        self,
        cita: models.CitaIncidencia,
        motivo_reprogramacion: Optional[str],
    ) -> models.CitaIncidencia:
        cita.motivo_reprogramacion = motivo_reprogramacion
        cita.updated_at = datetime.utcnow()
        return cita

    def update_cita_resultado_visita(
        self,
        cita: models.CitaIncidencia,
        resultado_visita: Optional[str],
    ) -> models.CitaIncidencia:
        cita.resultado_visita = resultado_visita
        cita.updated_at = datetime.utcnow()
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

    def update_incidencia_fecha_cierre(
        self,
        incidencia: models.Incidencia,
        fecha_cierre: Optional[datetime],
    ) -> models.Incidencia:
        incidencia.fecha_cierre = fecha_cierre
        return incidencia

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

    def create_presupuesto_incidencia(
        self,
        *,
        presupuesto_id: str,
        incidencia_id: str,
        proveedor_id: str,
        importe,
        moneda: str,
        descripcion: Optional[str],
        valido_hasta,
        estado: str,
        enviado_por_persona_id: Optional[str],
        fecha_envio: datetime,
    ) -> models.PresupuestoIncidencia:
        presupuesto = models.PresupuestoIncidencia(
            id=presupuesto_id,
            incidencia_id=incidencia_id,
            proveedor_id=proveedor_id,
            importe=importe,
            moneda=moneda,
            descripcion=descripcion,
            valido_hasta=valido_hasta,
            estado=estado,
            enviado_por_persona_id=enviado_por_persona_id,
            fecha_envio=fecha_envio,
            revisado_por_persona_id=None,
            fecha_revision=None,
            nota_aprobacion=None,
            nota_rechazo=None,
        )
        self.db.add(presupuesto)
        return presupuesto

    def update_presupuesto_revision(
        self,
        *,
        presupuesto: models.PresupuestoIncidencia,
        estado: str,
        revisado_por_persona_id: Optional[str],
        fecha_revision: Optional[datetime],
        nota_aprobacion: Optional[str],
        nota_rechazo: Optional[str],
    ) -> models.PresupuestoIncidencia:
        presupuesto.estado = estado
        presupuesto.revisado_por_persona_id = revisado_por_persona_id
        presupuesto.fecha_revision = fecha_revision
        presupuesto.nota_aprobacion = nota_aprobacion
        presupuesto.nota_rechazo = nota_rechazo
        return presupuesto

    def create_proveedor_bot(
        self,
        *,
        proveedor_id: str,
        user_id: int,
        nombre: str,
        rama_id: str,
        localidad_id: int,
        acepta_urgencias: bool,
        activo: bool = True,
        cif: Optional[str] = None,
        telefono: Optional[str] = None,
        persona_contacto: Optional[str] = None,
    ) -> models.Proveedor:
        now = datetime.utcnow()

        localidad_obj = (
            self.db.query(models.Localidad)
            .options(
                joinedload(models.Localidad.region).joinedload(models.Region.pais)
            )
            .filter(models.Localidad.id == localidad_id)
            .first()
        )

        if not localidad_obj:
            raise ValueError("localidad_id inválido")

        region_obj = getattr(localidad_obj, "region", None)
        pais_obj = getattr(region_obj, "pais", None) if region_obj else None

        proveedor = models.Proveedor(
            id=proveedor_id,
            user_id=user_id,
            nombre=nombre,
            rama_id=rama_id,
            localidad_id=localidad_obj.id,
            localidad=localidad_obj.nombre,
            comunidad=region_obj.nombre if region_obj else None,
            pais=pais_obj.nombre if pais_obj else None,
            activo=activo,
            acepta_urgencias=acepta_urgencias,
            cif=cif,
            telefono=telefono,
            persona_contacto=persona_contacto,
            created_at=now,
            updated_at=now,
        )
        self.db.add(proveedor)
        return proveedor

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

    def get_cita_by_id(
        self,
        cita_id: str,
    ) -> Optional[models.CitaIncidencia]:
        return (
            self.db.query(models.CitaIncidencia)
            .options(joinedload(models.CitaIncidencia.proveedor))
            .filter(models.CitaIncidencia.id == cita_id)
            .first()
        )

    def list_presupuestos_by_incidencia(
        self,
        incidencia_id: str,
    ) -> list[models.PresupuestoIncidencia]:
        return (
            self.db.query(models.PresupuestoIncidencia)
            .filter(models.PresupuestoIncidencia.incidencia_id == incidencia_id)
            .order_by(models.PresupuestoIncidencia.fecha_envio.desc())
            .all()
        )

    def get_presupuesto_by_id(
        self,
        presupuesto_id: str,
    ) -> Optional[models.PresupuestoIncidencia]:
        return (
            self.db.query(models.PresupuestoIncidencia)
            .filter(models.PresupuestoIncidencia.id == presupuesto_id)
            .first()
        )

    def get_active_sent_presupuesto_by_incidencia(
        self,
        incidencia_id: str,
    ) -> Optional[models.PresupuestoIncidencia]:
        return (
            self.db.query(models.PresupuestoIncidencia)
            .filter(
                models.PresupuestoIncidencia.incidencia_id == incidencia_id,
                models.PresupuestoIncidencia.estado == "sent",
            )
            .order_by(models.PresupuestoIncidencia.fecha_envio.desc())
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