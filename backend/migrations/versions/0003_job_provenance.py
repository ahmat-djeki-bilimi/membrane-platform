"""Traçabilité des tâches : provenance, historique des tentatives, exécution d'origine

Révision : 0003
Précédente : 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("jobs") as batch:
        batch.add_column(sa.Column("provenance", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("history", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("parent_id", sa.String(36), nullable=True))
        batch.create_index("ix_jobs_parent_id", ["parent_id"])


def downgrade() -> None:
    with op.batch_alter_table("jobs") as batch:
        batch.drop_index("ix_jobs_parent_id")
        batch.drop_column("parent_id")
        batch.drop_column("history")
        batch.drop_column("provenance")
